import axios, { AxiosResponse } from 'axios';
import Image from 'jimp';
import AWS from 'aws-sdk';
import { downloadImage } from './image';
import Bottleneck from 'bottleneck';
import redis from 'redis';
import { Context } from 'aws-lambda';

export const createShopifyApiClient = () => axios.create({
    baseURL: `https://${process.env.ShopifySubDomain}.myshopify.com/admin/api/2019-04`,
    auth: {
        username: process.env.ShopifyKey,
        password: process.env.ShopifyAppPassword,
    }
});

export interface ShopifyImage {
    id: number,
    src: string,
    variant_ids: number[]
}

export interface ShopifyProduct {
    variants: ShopifyVariant[],
    id: number,
    images: ShopifyImage[],
}

export interface ShopifyVariant {
    id: number,
    sku: string
}

/**
 * Executes various product/variant related operations (create, update, delete, get).
 * Records the SKUs associated with each variant in database. Makes it possible to easily access
 * a variant/product using it's SKU.
 *
 * NOTE: Operations not performed by the SkuAwareProductManager are not be recorded. If another system creates
 * a product, the SKU will not be stored in our database. This means the product won't be accessible by SKU. It
 * will be as if it does not even exist. This shouldn't be a problem however, at Trail & Ski we don't enter product
 * data manually.
 */
export class BetterProductApi {
    private dynamoDb = new AWS.DynamoDB();
    private bottleneck: Bottleneck;

    // Rate Limited Axios Methods
    private post;
    private put;
    private get;
    private delete;

    async connectRateLimiter(lambdaContext: Context) {
        const shopifyApi = createShopifyApiClient();

        this.bottleneck = new Bottleneck({
            // https://shopify.dev/concepts/about-apis/rate-limits
            reservoirIncreaseAmount: 2,
            reservoirIncreaseInterval: 1000,
            reservoirIncreaseMaximum: 40,
            reservoir: 40,

            datastore: 'redis',
            id: 'shopify-admin-api',
            timeout: lambdaContext.getRemainingTimeInMillis(),
            clientOptions: {
                host: process.env.BottleneckDatabaseAddress,
                port: process.env.BottleneckDatabasePort
            }
        });

        this.bottleneck.on('error', console.error);

        await this.bottleneck.ready();
        console.debug('Bottleneck ready.');

        this.post = this.bottleneck.wrap(shopifyApi.post);
        this.put = this.bottleneck.wrap(shopifyApi.put);
        this.get = this.bottleneck.wrap(shopifyApi.get);
        this.delete = this.bottleneck.wrap(shopifyApi.delete);

        // this.post = shopifyApi.post;
        // this.put = shopifyApi.put;
        // this.get = shopifyApi.get;
        // this.delete = shopifyApi.delete;
    }

    async close() {
        await this.bottleneck.done();
    }

    /**
     * Attaches the given image to the given variant.
     * If another image with the exact same pixels already exists inside the product, the variant will
     * be associated with that image and the upload will be skipped.
     */
    async attachImage(product: ShopifyProduct, variantId: number, newImage: Image) {
        // Download all the images associated with this product.
        const existingImages = await Promise.all(
            product.images
                .map(async (imageHandle) => {
                    const imageData = await downloadImage(imageHandle.src);
                    const shopifyImageId = imageHandle.id;
                    return { shopifyImageId, imageData };
                })
        );

        // Check if any previously uploaded images are similar to this image.
        const similarExistingImage
            = existingImages.find(existing => existing.imageData.hash() === newImage.hash());

        if (similarExistingImage) {
            // This product already contains a similar image to the one we are trying to attach.
            // Instead of attaching two of the same images, just associate the existing image with this variant too.
            console.debug('Linking existing image...');
            await this.put(`/products/${product.id}/variants/${variantId}.json`, {
                variant: {
                    id: variantId,
                    image_id: similarExistingImage.shopifyImageId
                }
            });
            console.debug('Linked existing image.');
        } else {
            console.debug('Creating new image.');
            // Upload the image to Shopify and attach it to the variant.
            await this.post(`/products/${product.id}/images.json`, {
                image: {
                    attachment:  (await newImage.getBufferAsync(newImage.getMIME())).toString("base64"),
                    variant_ids: [variantId]
                }
            });
            console.debug('Created new image.');
        }

    }

    async getProductFromHandle(handle: string): Promise<ShopifyProduct | null> {
        const response = await this.get('products.json', {
            params: {
                handle: handle
            }
        });

        const products = response.data.products;

        if (products.length > 0) {
            return products[0];
        } else if (products.length < 1) {
            return null;
        } else {
            throw new Error('Shopify handles are unique. No two products can have the same handle.');
        }
    }

    private async deleteAssociation(sku: string) {
        await this.dynamoDb.deleteItem({
            TableName: process.env.SkuVariantMapTableName,
            Key: {
                Sku: {
                    S: sku
                }
            }
        }).promise();
    }

    /**
     * Returns the Shopify product whose variant has this SKU.
     * Checks to make sure the product and variant actually exist in Shopify.
     */
    async getProductFromSku(sku: string): Promise<ShopifyProduct | null> {
        // If our database contained an association, but the product or variant has already been deleted from Shopify,
        // delete the stale entry from our database automatically.
        const association = (await this.dynamoDb.getItem({
            TableName: process.env.SkuVariantMapTableName,
            Key: {
                Sku: {
                    S: sku
                }
            }
        }).promise()).Item;

        // If no association was found, then no variant has been published with this SKU.
        // We're all done here.
        if (!association) {
            return null;
        }

        // Make sure the product still exists in Shopify.
        let product: ShopifyProduct;
        try {
            const productId = association.ShopifyProductId.N;
            const response = await this.get(`products/${productId}.json`);
            product = response.data.product;
        } catch (error) {
            if (error.response?.status === 404) {
                // The product was been deleted from Shopify manually.
                // Remove this stale entry from the database.
                await this.deleteAssociation(sku);
                return null; // The product did not exist.
            } else {
                throw error; // Not sure what went wrong here. Let this error bubble up.
            }
        }

        const variant: ShopifyVariant
            = product.variants.find(variant => variant.id.toString() === association.ShopifyVariantId.N);

        if (variant) {
            // We found a variant with that SKU in the product!
            // Everything went well. Return the product that the caller requested.
            return product;
        } else {
            // The variant was deleted from Shopify manually.
            // Remove this stale entry from the database.
            await this.deleteAssociation(sku);

            // The supposed product did not contain a variant with the SKU that we expected.
            // It turns out this SKU is not actually associated with this product.
            return null;
        }
    }

    /**
     * Deletes the Shopify variant with the provided SKU.
     * Removes the SKU association from the Springify database.
     * If the image associated with this variant is not associated with any other variants, deletes the image.
     * If this is the only variant of the product, the entire product will be deleted.
     * @param product the fully qualified Shopify Product that contains the variant.
     * @param sku the variant's sku
     */
    async deleteVariant(product: ShopifyProduct, sku: string) {
        const variant = product.variants.find(variant => variant.sku === sku);

        if (!variant) {
            throw new Error('This product does not contain any variant with that SKU.');
        }

        if (product.variants.length === 1) {
            // This is the last variant in the product. Just delete the entire product.
            await this.delete(`products/${product.id}.json`);
        } else {
            // Delete the variant.
            await this.delete(`products/${product.id}/variants/${variant.id}.json`);

            // If there is an image attached to this variant, and no other variants depend on this image, delete the image.
            const attachedImage = product.images.find(image => image.variant_ids.includes(variant.id));
            if (attachedImage && attachedImage.variant_ids.length === 1) {
                await this.delete(`products/${product.id}/images/${attachedImage.id}.json`);
            }
        }

        // Remove the SKU association from our database.
        await this.deleteAssociation(sku);
    }

    /**
     * Creates a new Shopify variant.
     * Adds a SKU-association to the database. That way, this variant can be accessed easily later.
     * @param product the fully qualified Shopify product that will contain this variant.
     * @param variant the variant to insert into this product
     */
    async createVariant(product: ShopifyProduct, variant: any): Promise<ShopifyVariant> {
        // Create the variant
        const response = await this.post(`products/${product.id}/variants.json`, { variant });

        // Create the SKU-association in our database.
        await this.dynamoDb.putItem({
            TableName: process.env.SkuVariantMapTableName,
            Item: {
                Sku: {
                    S: variant.sku
                },
                ShopifyProductId: {
                    N: product.id.toString()
                },
                ShopifyVariantId: {
                    N: response.data.variant.id.toString()
                }
            }
        }).promise();

        return response.data.variant;
    }

    /**
     * Creates a new Shopify product,
     * Adds a SKU-association to the database for this product's initial variant.
     * @param product initial product properties
     */
    async createProduct(product: any): Promise<ShopifyProduct> {
        let response: AxiosResponse;

        try {
            response = await this.post('products.json', { product });
        } catch (error) {
            // Knowing exactly what we sent Shopify should be extremely helpful when debugging product
            // creation errors.
            console.error(product);
            throw error;
        }


        // Create the SKU-association in our database.
        await this.dynamoDb.putItem({
            TableName: process.env.SkuVariantMapTableName,
            Item: {
                Sku: {
                    S: product.variants[0].sku
                },
                ShopifyProductId: {
                    N: response.data.product.id.toString()
                },
                ShopifyVariantId: {
                    N: response.data.product.variants[0].id.toString()
                }
            }
        }).promise();

        return response.data.product;
    }
}
