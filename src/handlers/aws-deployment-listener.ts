import { Handler } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import { GetItemInput } from 'aws-sdk/clients/dynamodb';
import { createSpringboardApiClient } from '../springboard';
import { AxiosInstance } from 'axios';

const springboard: AxiosInstance = createSpringboardApiClient();

export const onSuccessfulAWSDeployment: Handler = (event, context, callback) => {
    const dynamoDB = new AWS.DynamoDB();
    const query: GetItemInput = {
        Key: {
            'Key': {
                S: 'SpringboardItemListenerWebhookId'
            }
        },
        TableName: process.env.GeneralKVStoreName!
    };

    dynamoDB.getItem(query, (err, data) => {
        if (err) {
            console.warn('Springboard event handlers might not be registered.');
            console.error(err);
            return;
        }

        const webHookId = data.Item?.Value.S;

        if (!webHookId) {
            console.info('No Springboard event handler found. Registering one now...');
            const webhook = {
                url: process.env.SpringboardItemListenerEndpoint,
                events: ['item_updated', 'item_created']
            };
            springboard.post('webhooks', webhook)
                // Save the webhook id in our application's key value store.
                // This way we will know not to register another webhook upon the next deployment.
                .then(response => dynamoDB.putItem({
                    TableName: process.env.GeneralKVStoreName!,
                    Item: {
                        Key: {
                            S: 'SpringboardItemListenerWebhookId'
                        },
                        Value: {
                            S: response.data.id.toString()
                        }
                    }
                }).promise())
                .then(() => callback())
                .catch(error => {
                    console.warn('Could not register Springboard event handler.');
                    console.warn('Instant product updates are disabled.');
                    console.error(error);
                })
        }
    });

};
