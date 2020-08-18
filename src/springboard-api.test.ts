/**
 * A series of tests for determining the behavior of Springboard Retail API. The most temperamental and inconsistent
 * POS system ever. This file includes tests for API endpoints that are not listed on the official documentation.
 * Official API Docs: https://dev.retail.heartland.us/
 */

import assert from 'assert';
import axios from 'axios';
import { v5 as uuidv5 } from 'uuid';
import puppeteer from 'puppeteer';
import { Browser, Page } from 'puppeteer';
import * as util from 'util';
import { readFileSync } from 'fs';

const sleep = util.promisify(setTimeout);

// Our development instance of Springboard Retail
const stagingConfig = JSON.parse(readFileSync(__dirname + '/../configs/staging.json').toString());
const springboardCredentials = {
    token: stagingConfig.samArgs.SpringboardToken,
    subDomain: stagingConfig.samArgs.SpringboardSubDomain
};
const springboard = axios.create({
    headers: {
        'Authorization': `Bearer ${springboardCredentials.token}`
    },
    baseURL: `https://${springboardCredentials.subDomain}.myspringboard.us/api`
});

// A service that acts as a box of requests. Useful for testing webhooks.
const postbin = axios.create({
    baseURL: 'https://postb.in'
});

// A test item to be used during testing.
// https://trailandski-staging.myspringboard.us/#items/edit/158026
const testItemId = 158026;
before('ensure test item exists', () => {
    return springboard.get(`items/${testItemId}`)
        .then(response => {
            assert(response.status === 200)
        })
        .catch(error => {
            if (error.response && error.response.status === 404) {
                assert.fail('The test item does not exist. Did someone delete it? Create a new Springboard item' +
                    ' with ID ' + testItemId + ' to run this test.');
            }
            assert.fail(error);
        })
});

// An arbitrary image that we can use inside of various tests.
// For example: Some tests might need to upload an item image.
// This image is hosted on trailandski.com and should always exist.
const sampleImageUrl = 'https://cdn.shopify.com/s/files/1/1710/8813/files/shadow_logo_360x.png';

/**
 * Checks whether or not Springboard fired an event recently.
 * @param binId the postbin that Springboard might send the event to.
 * @param expectEventDispatch true if assertion should fail when no event is dispatched. false if assertion should
 * fail if an event was dispatched.
 */
const assertWebHookBehavior = async (binId: string, expectEventDispatch: boolean) => {
    // Wait a few seconds for Springboard to fire the event.
    await sleep(3000);

    // Check the bin and make sure the event was sent to us by Springboard.
    try {
        await postbin.get('/api/bin/' + binId + '/req/shift');
        // If we made it here, Springboard Retail dispatched an event.
        if (!expectEventDispatch) {
            // If we did not expect Springboard to dispatch an event, and they did,
            // throw an error.
            assert.fail('Springboard dispatched an event. The behavior of the API has changed.');
        }
    } catch (error) {
        if (expectEventDispatch) {
            if (error.response && error.response.statusMessage === 'Request Does Not Exist') {
                assert.fail('Springboard Retail never sent an event to our webhook.');
            } else {
                // An unexpected error occurred.
                // Maybe it's postbin related? Check here: https://postb.in/api/.
                assert.fail(error);
            }
        }
    }
};

describe('Item Webhook Behavior', () => {
    // The ID of the temporary Springboard Retail webhook we created.
    let webhookId: number;

    // The ID of the postbin that will receive events from Springboard Retail.
    let binId: string;

    before('create temporary webhook', async () => {
        // Create postbin that will receive the fired event.
        binId = (await postbin.post('/api/bin')).data.binId;

        // Create the temporary Springboard Retail webhook.
        webhookId = (await springboard.post(
            '/webhooks',
            {
                url: postbin.defaults.baseURL + '/' + binId,
                events: ['item_updated']
            }
        )).data.id;
    });

    after('delete temporary webhook', async () => {
        // Delete the bin
        await postbin.delete('/api/bin/' + binId);

        // Delete the webhook.
        await springboard.delete('webhooks/' + webhookId);

    });

    describe('Tests using front end puppeteering', () => {
        let browser: Browser;
        let page: Page;
        // Login to the Springboard Retail web app.
        before(async function() {
            // Browser control can be pretty time consuming
            this.timeout(40 * 1000);

            browser = await puppeteer.launch();
            page = await browser.newPage();
            // Navigate to the item editor page.
            await page.goto('https://' + springboardCredentials.subDomain  + '.myspringboard.us/#items/edit/' + testItemId);
            // Wait for login screen to load.
            await page.waitForSelector('#login');
            // Assign an image to the item.
            const userCredentials = JSON.parse(readFileSync(`${__dirname}/../springboard-credentials.json`).toString());
            await page.evaluate(({ username, password }) => {
                // Fill in the username and password fields.
                const usernameInputField = document.getElementById('login') as HTMLInputElement;
                usernameInputField.value = username;
                const passwordInputField = document.getElementById('password') as HTMLInputElement;
                passwordInputField.value = password;
            }, userCredentials);
            // Click the Login button.
            await page.click('#login-button');
            await page.waitForNavigation();
        });

        // Close the browser. We're finished testing Springboard Retail's front end.
        after(async () => {
            await browser.close();
        });

        it('does not fire an event when an item image is uploaded', async () => {
            // Click "Add Image" button.
            await page.waitForSelector('.button.add-image');
            await page.click('.button.add-image');
            // Type URL into text field.
            await page.waitForSelector('#url-file');
            await page.click('#url-file');
            await page.keyboard.type(sampleImageUrl);
            // Press the "Upload" button.
            await page.evaluate(() => {
                const uploadButton = Array.from(document.getElementsByClassName('button'))
                    .filter(element => element.textContent === 'Fetch')
                    .pop();
                // @ts-ignore
                uploadButton!.click();
            });

            // Check if Springboard Retail fired an item_updated event.
            return assertWebHookBehavior(binId, false);
        }).timeout(15 * 1000);
    });

    describe('Tests using backend API calls', async () => {
        it('fires an event when an item\'s text properties are updated', async () => {
            // Update the item. This is the same HTTP endpoint that the Springboard Retail frontend hits.
            // This request should trigger an item_updated event.
            await springboard.put('/items/' + testItemId, {
                // Set the UUID to a random alphanumeric string.
                // This change is completely arbitrary. We could change any field.
                // We are just trying to make Springboard Retail send an item_updated event to our webhook.
                'custom@upc_gtin': uuidv5('trailandski.com', uuidv5.DNS)
            });

            return assertWebHookBehavior(binId, true);
        }).timeout(5000);


        // Because Springboard does not notify our app when an image is deleted, we must detect these changes
        // manually.
        it('does not fire an event when an item image is deleted', async () => {
            const imgId = (await springboard.get('/items/' + testItemId)).data.primary_image_id as number;

            await springboard.delete('/items/' + testItemId + '/images/' + imgId);

            return assertWebHookBehavior(binId, false);
        }).timeout(5000);
    });

});

describe('Item Image Creation API', () => {
    // Delete the images we created after each test completes.
    afterEach(async () => {
        const images = (await springboard.get(
            '/items/' + testItemId + '/images',
        )).data.results as any[];

        await Promise.all(
            images.map(img => springboard.delete('/items/' + testItemId + '/images/' + img.id))
        )
    });

    // Ensure Springboard Retail still allows image creation using the non-cdn endpoint.
    // Using the non-cdn endpoint is dangerous, as Springboard may store the image as as a direct link to the URL.
    // Meaning, if someone changes the file hosted at the URL, the image will change in our system as well.
    it('creates an image', async () => {
        await springboard.post(
            '/items/' + testItemId + '/images',
            {
                source: 'url',
                url: sampleImageUrl
            }
        );
    });

    it('returns a list of all images that have been created since a certain time', async () => {
        // Filtering by DateTime appears to be precise to the minute.
        // Subtract 2 minutes from the current time.
        // This ensure that are filter comes before the current minute.
        // Before the minute where we upload the item,
        const startTime = Date.now() - 2 * 60 * 1000;

        // Create a new image.
        const response = await springboard.post(
            '/items/' + testItemId + '/images',
            {
                source: 'url',
                url: sampleImageUrl,
                item_id: testItemId
            }
        );

        // Springboard does not send a copy of the newly created image.
        // The new image's id must be discerned yourself.
        // You could take a snapshot of the images list before and after and find the dif.
        const imageId = response.data?.id;
        assert(!imageId, 'The endpoint returned the ID of the created image.');

        const filter = {
            'created_at': {
                '$gt': new Date(startTime).toISOString()
            }
        };

        const images = (await springboard.get(
            '/items/' + testItemId + '/images',
            {
                params: {
                    '_filter': JSON.stringify(filter)
                }
            }
        )).data.results as any[];

        assert(images.length > 0, 'Expected one image to be returned.');
    });

    it('item.updated_at is set upon new primary image', async () => {
        // Other tests might update the test item too.
        await sleep(1000);

        await springboard.post(
            '/items/' + testItemId + '/images',
            {
                source: 'url',
                url: sampleImageUrl
            }
        );

        const item = (await springboard.get('/items/' + testItemId)).data;

        assert(Date.now() - Date.parse(item.updated_at) < 1000, 'Expected time to be the same.');
    });
});


it('item.updated_at is not set when deleting an item image', async () => {
    // Create the image
    await springboard.post(
        '/items/' + testItemId + '/images',
        {
            source: 'url',
            url: sampleImageUrl
        }
    );

    // Wait a few seconds.
    // We want to make sure that the deletion operation is actually causing updated_at to be changed, and not
    // the creation operation.
    await sleep(10000);

    // Delete the image
    const image = (await springboard.get(
        '/items/' + testItemId + '/images',
    )).data.results[0];
    await springboard.delete('/items/' + testItemId + '/images/' + image.id);
    const deletedAt = Date.now();

    // Assert: Deleting the image does not cause updated_at to be set.
    const item = (await springboard.get('/items/' + testItemId)).data;
    assert(!(deletedAt - Date.parse(item.updated_at) < 1000), 'Expected time to be different.');
}).timeout(20 * 1000);
