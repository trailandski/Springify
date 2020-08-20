import { JSDOM } from 'jsdom';

/**
 * Removes in-line styling and font tags from a string of HTML.
 * Why? During the earlier phases of the online store, we used a lot of product descriptions from other websites.
 * This scraping caused a ton of inconsistent styling to leak into the Springboard Item Long Description field.
 * @param html the html to de-style.
 */
export const removeStylingFromHTML = (html: string) => {
    const doc = new JSDOM(html).window.document;

    // Get all HTML elements that have an inline style attached to them.
    doc.querySelectorAll('[style]')
        // Remove the inline style attribute, effectively removing the styling.
        .forEach((el) => el.removeAttribute('style'));

    // Get all HTML font elements.
    doc.querySelectorAll('font')
        // Remove the all the attributes from the font element, effectively making it useless.
        .forEach((el) => {
            while (el.attributes.length > 0) {
                el.removeAttribute(el.attributes[0].name)
            }
        });

    return doc.body.innerHTML
};
