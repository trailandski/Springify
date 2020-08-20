import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);

export interface ProductType {
    subClass: string,
    name: string,
    shippingLevel: number
}

export async function getProductTypes(): Promise<ProductType[]> {
    let rawFileContents: string;

    try {
        rawFileContents = (await readFile(`${__dirname}/configs/product-types.csv`)).toString()
    } catch (error) {
        console.log(error);
        console.warn('An error occurred while reading configs/product-types.csv.');
        console.warn('This will probably result in all collections being empty.');
        console.warn('This will probably result in most items being marked as \"In-Store Pickup Only\".');
        return [];
    }

    const productTypes: ProductType[] = [];

    let lineNo = 0;
    for (const line of rawFileContents.split('\n')) {
        // Skip the header line.
        if (++lineNo === 1) continue;

        try {
            const cells = line.split(',');

            const type = {
                subClass: cells[0].trim(),
                name: cells[1].trim(),
                shippingLevel: parseInt(cells[2].trim())
            };

            if (isNaN(type.shippingLevel)) {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error('Shipping level is not number.');
            }

            productTypes.push(type);
        } catch (error) {
            console.warn(`An error occurred while processing line #${lineNo} of product-types.csv.`);
            console.warn('Line: ' + line);
            console.warn(error);
        }
    }

    return productTypes;
}
