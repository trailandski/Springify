const jimp = require('jimp');
const request = require('request-promise-native');

export const downloadImage = async (url) => {
    // TODO: Convert to axios
    const buffer = await request({
        url,
        encoding: null,
        timeout: 1000 * 5,
        headers: {
            // Some CDNs (like Shopify's) reject requests with no user-agent.
            'User-Agent': 'Springify3'
        }
    });

    return jimp.read(buffer);
};

export const squareImage = async (image) => {
    const width = image.getWidth();
    const height = image.getHeight();

    let longestSide = -1;

    if (width > height) {
        longestSide = width
    } else if (height > width) {
        longestSide = height
    }

    if (longestSide !== -1) {
        await image
            .background(0xFFFFFFFF)
            .contain(longestSide, longestSide)
    }
};
