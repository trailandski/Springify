/**
 * This file is the meat of Springify. It contains most of the logic allowing Springboard items to be converted
 * to Shopify products. Furthermore this file contains that AWS Lambda handler that processes Springboard Item Update
 * Events and pushes the changes to Shopify.
 */

import { Context, SQSEvent, SQSHandler } from 'aws-lambda';
import { BetterProductApi, ShopifyVariant } from '../shopify';
import Jimp from 'jimp';
import { downloadImage, squareImage } from '../image';
import * as crypto from 'crypto';
import { getProductTypes, ProductType } from '../config';
import { removeStylingFromHTML } from '../html';

const productTypes: Promise<ProductType[]> = getProductTypes();
const shopifyProductApi = new BetterProductApi();

/**
 * This is the first step of pushing an item update event to Shopify.
 * Checks to see if there is a previous version of this item already uploaded to Shopify.
 * If there is, then this function deletes that item.
 * @param itemEvent the Springboard item update event
 */
const deleteStaleShopifyData = async (itemEvent: any) => {
    // First step, check if the item is already associated with a Shopify product.
    // In other words, this item was previously uploaded to Shopify.
    const product = await shopifyProductApi.getProductFromSku(itemEvent.public_id);

    if (product) {
        // A product/variant already exists for this Springboard item.
        // It is outdated, so delete it. We will create a new product/variant with up to date information.
        // Not the most efficient solution, but I value simplicity over performance in this case.
        await shopifyProductApi.deleteVariant(product, itemEvent.public_id);

        console.debug('Deleted stale Shopify variant.');
    }
};

const getShopifyProductOptionsBasedOnSpringboardItem = (itemEvent) => {
    const options = [];

    // The Springboard custom fields that are to be used as Shopify Product Options.
    const customFieldsToUse = ['size', 'color', 'length'];

    for (const customFieldName of customFieldsToUse) {
        // Get the value stored in that custom field.
        const value = itemEvent.custom[customFieldName];

        if (value) {
            let name = customFieldName;

            if (name === 'length') {
                name = '2nd Dimension'
            }

            options.push({ name, value });
        }
    }

    return options;
};

class UnpublishableItemError extends Error {
    constructor(item: any, message: string) {
        super(`Refusing to publish Item #${item.public_id} because ${message}.`);
    }
}

const getShopifyHandleBasedOnSpringboardItem = (springboardItem: any) => {
    /**
     * The various components that go into a Shopify handle. Items that have the same value for each of these
     * properties will be grouped into the same product.
     */
    const components =  [
        'springify4',
        springboardItem.custom.gender,
        springboardItem.custom.brand || springboardItem.primary_vendor_id,

        // All variants of a product must share the same options.
        `${springboardItem.custom.color ? 'color' : ''}${springboardItem.custom.size ? 'size' : ''}`,

        springboardItem.grid ? springboardItem.grid.description : springboardItem.description
    ].join();

    return crypto.createHash('md5').update(components).digest('hex');
};


const convertSpringboardItemToShopifyVariant = async (itemEvent) => {
    const optionValues = getShopifyProductOptionsBasedOnSpringboardItem(itemEvent)
        .map(option => option.value);

    const type = (await productTypes)
        .find(type => type.subClass === itemEvent.custom.sub_class);

    const variant: any = {
        sku: itemEvent.public_id,
        taxable: itemEvent.custom.tax_category === 'Taxable',
        option1: optionValues[0],
        option2: optionValues[1],
        option3: optionValues[2],
        barcode: itemEvent.custom.upc_gtin,
        fulfillment_service: 'springboard-retail',
        inventory_management: 'shopify',
        compare_at_price: itemEvent.original_price,
        weight_unit: "kg",
        // OOSP Policy a.k.a Online Out-of-Stock Purchase Policy
        // If set to Allow, the website will show this item as in-stock, despite having no in-stock inventory.
        inventory_policy: itemEvent.custom.oosp_policy === 'Allow' ? 'continue' : 'deny',
    };

    // Shipping Level Logic
    let shippingLevel;
    if (type && type.shippingLevel) {
        shippingLevel = type.shippingLevel;
    } else {
        console.warn(`No default shipping level set for Sub Class: ${itemEvent.custom.sub_class}.`);
        console.warn('Add an entry to configs/product-types.csv');
    }
    if (itemEvent.custom.shipping_level) {
        const inlineShippingLevel = parseInt(itemEvent.custom.shipping_level);

        // Make sure the user put a number in this field and not some arbitrary string.
        // Springboard provides no way of limiting the type of a custom field as of right now.
        if (isNaN(inlineShippingLevel)) {
            console.warn(`Encountered illegal inline shipping level in Item #${itemEvent.public_id}.`);
            console.warn(`${inlineShippingLevel} is not a valid Shipping Level.`);
            console.warn('Consult the README.md file for an a primer on Shipping Levels.');
            console.warn(`Falling back to Shipping Level of ${shippingLevel} instead.`);
        } else {
            shippingLevel = inlineShippingLevel;
        }

    }
    if (shippingLevel !== 0 && !shippingLevel) {
        console.warn('No default or inline shipping level has been set.');
        console.warn('Using emergency fallback shipping level of 1. ');
        console.warn('You should specify a shipping level for this product immediately. Otherwise' +
            ' customers may be undercharged for shipping.');
        shippingLevel = 1;
    }
    if (shippingLevel === -1) {
        throw new UnpublishableItemError(itemEvent, 'Shipping level is set to -1.')
    }
    if (shippingLevel < -2) {
        console.warn(`Encountered illegal shipping level: ${shippingLevel} while processing Item #${itemEvent.public_id}.`);
        console.warn('Check the item\'s Shipping Level field or configs/product-types.csv.');
        console.warn(`Assigning Item ${itemEvent.public_id} a Shipping Level of -2 instead.`);
        shippingLevel = -2;
    }
    // Shopify does not support negative weights.
    // A weight of zero is given to variants that meet ANY of these criteria.
    // - In Store Pickup Only
    // - Free Shipping Eligible
    variant.weight = shippingLevel < 0 ? 0 : shippingLevel;
    // A shipping level of -2 means the item is In-Store Pickup Only.
    variant.requires_shipping = shippingLevel > -1;

    // Pricing Logic
    {
        const allowBelowMAPPrice = itemEvent.custom.map === 'Not Enforced';
        let mapThreshold = parseInt(itemEvent.custom.minimum_advertrised_price);
        if (isNaN(mapThreshold) || mapThreshold === null) {
            mapThreshold = itemEvent.original_price;
        }
        if (!allowBelowMAPPrice && !mapThreshold) {
            // MAP is Enforced but no threshold has been set.
            throw new UnpublishableItemError(itemEvent, 'No MAP Threshold defined. See Pricing section of README.md');
        }
        const webPrice = parseInt(itemEvent.custom.web_price);
        let price;
        if (allowBelowMAPPrice) {
            if (isNaN(webPrice)) {
                price = itemEvent.price;
            } else {
                price = webPrice;
            }
        } else {
            if (!isNaN(webPrice)) {
                if (webPrice < mapThreshold) {
                    throw new UnpublishableItemError(itemEvent, 'Web Price is set below MAP Threshold.');
                } else {
                    price = webPrice;
                }
            } else {
                // No Web Price Defined
                if (itemEvent.price < mapThreshold) {
                    price = mapThreshold;
                } else {
                    price = itemEvent.price;
                }
            }
        }
        variant.price = price;
    }
    return variant;
};

const convertSpringboardItemToShopifyProduct = async (itemEvent) => {
    const product: any = {
        product_type: itemEvent.custom.sub_class,
        title: itemEvent.grid ? itemEvent.grid.description : itemEvent.description,
        body_html: removeStylingFromHTML(itemEvent.long_description),
        handle: getShopifyHandleBasedOnSpringboardItem(itemEvent),
        vendor: itemEvent.primary_vendor ? itemEvent.primary_vendor.name : '',
        variants: [await convertSpringboardItemToShopifyVariant(itemEvent)],
        options: getShopifyProductOptionsBasedOnSpringboardItem(itemEvent).map(it => ({ name: it.name }))
    };

    const tags = ['springify4'];

    // Product Type Tag
    {
        const type = (await productTypes)
            .find(type => type.subClass === itemEvent.custom.sub_class);

        if (type) {
            // Add the "Product Type" tag. This tag makes it possible for users to sort by type on the frontend.
            tags.push(`Type_${type.name}`);
        } else {
            console.warn(`Could not find product type for sub class: ${itemEvent.custom.sub_class}.`);
            console.warn('You should add this sub class to configs/product-types.csv.');
        }
    }

    // Gender Tag
    {
        if (itemEvent.custom.gender) {
            switch (itemEvent.custom.gender) {
                case "Unisex": {
                    tags.push("Gender_Mens", "Gender_Womens");
                    break
                }
                case "Kids": {
                    tags.push("Gender_Boys", "Gender_Girls");
                    break
                }
                default: {
                    tags.push(`Gender_${itemEvent.custom.gender}`);
                    tags.push(`GenderPrefix: ${itemEvent.custom.gender}`);
                    break
                }
            }
        }
    }

    // Brand Tag
    {
        let brandName = null;

        if (itemEvent.primary_vendor) {
            brandName = itemEvent.primary_vendor.name;
        }

        if (itemEvent.custom.brand) {
            brandName = itemEvent.custom.brand;
        }

        if (brandName) {
            tags.push(`Brand_${brandName}`)
        }
    }

    product.tags = tags.join(',');

    return product;
};

const downloadAndNormalizePrimaryItemImage = async (itemEvent: any) => {
    // Get the Springboard Retail Image Handle associated with this item.
    const imageHandle = itemEvent.primary_image;
    const image = await downloadImage(imageHandle.url);
    await squareImage(image);
    return image;
};

export const applyFreshShopifyData = async (itemEvent) => {
    // Check if a product exists for this type of item.
    // In other words, see if one of this item's siblings has already been uploaded to Shopify.
    // If this is the case, we won't need to create a new product. Instead we will add this variant to the
    // existing product.
    const handle = getShopifyHandleBasedOnSpringboardItem(itemEvent);

    console.debug('Checking for pre-existing siblings...');
    let product = await shopifyProductApi.getProductFromHandle(handle);
    console.debug('Finished.');

    let image: Jimp;

    if (itemEvent.primary_image) {
        console.debug('Downloading primary image...');
        image = await downloadAndNormalizePrimaryItemImage(itemEvent);
        console.debug('Downloaded primary image.');
    }

    let variant: ShopifyVariant;

    if (product) {
        // Attempt to convert the Springboard Item to Shopify Variant format.
        const variantCreateRequestPayload = await convertSpringboardItemToShopifyVariant(itemEvent);


        // Add a new variant to the existing product.
        console.debug('Adding variant...');
        variant = await shopifyProductApi.createVariant(product, variantCreateRequestPayload);
        console.debug('Added new variant.');
    } else {
        // Create a brand new product.
        // None of this item's siblings have been published to Shopify yet.

        const productCreateRequestPayload = await convertSpringboardItemToShopifyProduct(itemEvent);

        console.debug('Creating new product...');
        product = await shopifyProductApi.createProduct(productCreateRequestPayload);
        variant = product.variants[0];

        console.debug('Created new product.');
    }

    if (itemEvent.primary_image) {
        // Attach a new image to the product if necessary.
        await shopifyProductApi.attachImage(product, variant.id, image);
        console.debug('Attached image.');
    }

    console.info(`Successfully published Item #${itemEvent.public_id} to Shopify!`);
};

/**
 * Applies Springboard item update events to the Shopify web store.
 * @param event the amazon SQS event that contains the Springboard item update event.
 * @param context AWS Lambda execution context.
 */
export const processItemUpdateEvents: SQSHandler = async (event: SQSEvent, context: Context) => {
    await shopifyProductApi.connectRateLimiter(context);

    try {
        for (const record of event.Records) {
            const itemEvent = JSON.parse(record.body);

            console.debug(`Processing Springboard Item #${itemEvent.public_id}`);

            // If this item has a Shopify counterpart already, delete it.
            // We will create a new one with fresh, up to date data.
            await deleteStaleShopifyData(itemEvent);
            console.debug('Complete: Stale Data Deletion Phase');

            // Only publish active items.
            if (itemEvent['active?']) {
                await applyFreshShopifyData(itemEvent);
            }

            console.debug('Complete: Fresh Data Application Phase')
        }
    } catch (error) {
        // If the error came from axios, print the response body.
        // Most APIs will send a pretty useful error message back.
        if (error.response && error.response.data) {
            console.error(error.response.data);
        }

        await shopifyProductApi.close();

        // Fail the SQS message.
        throw error;
    }

    await shopifyProductApi.close();
};
