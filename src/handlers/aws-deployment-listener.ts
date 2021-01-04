import { Handler } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import { GetItemInput } from 'aws-sdk/clients/dynamodb';
import { createSpringboardApiClient } from '../springboard';
import { AxiosInstance } from 'axios';

const dynamoDB = new AWS.DynamoDB();

const registerSpringboardEventHandlers = async () => {
    const springboard: AxiosInstance = createSpringboardApiClient();

    const query: GetItemInput = {
        Key: {
            'Key': {
                S: 'SpringboardItemListenerWebhookId'
            }
        },
        TableName: process.env.GeneralKVStoreName!
    };

    try {
        const webHookId = (await dynamoDB.getItem(query).promise()).Item?.Value.S;

        if (!webHookId) {
            console.info('No Springboard event handler found. Registering one now...');
            const webhook = {
                url: process.env.SpringboardItemListenerEndpoint,
                events: ['item_updated', 'item_created']
            };

            const response = await springboard.post('webhooks', webhook);

            // Save the webhook id in our application's key value store.
            // This way we will know not to register another webhook upon the next deployment.
            await dynamoDB.putItem({
                TableName: process.env.GeneralKVStoreName!,
                Item: {
                    Key: {
                        S: 'SpringboardItemListenerWebhookId'
                    },
                    Value: {
                        S: response.data.id.toString()
                    }
                }
            }).promise();
        }
    } catch (error) {
        console.warn('Springboard event handlers might not be registered.');
        console.warn('Instant product updates might not be enabled.');
        console.error(error);
    }
};

const registerShopifyEventHandlers = async () => {

};

export const onSuccessfulAWSDeployment: Handler = async (event, context) => {
    await Promise.all([
        // registerSpringboardEventHandlers(),
        registerShopifyEventHandlers()
    ]);
};
