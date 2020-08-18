import { APIGatewayProxyHandler } from 'aws-lambda';
import * as AWS from 'aws-sdk';

export const springboardDidSendItemEvent: APIGatewayProxyHandler = (event, context, callback) => {
    const sqs = new AWS.SQS();
    const item = JSON.parse(event.body!);
    sqs.sendMessage({
        QueueUrl: process.env.QueueUrl!,
        MessageGroupId: 'SpringboardItemUpdate',
        MessageBody: event.body!,
        MessageDeduplicationId: `${item.id}${item.updated_at}`
    }, (error, data) => {
        if (error) {
            console.warn('Failed to add item update event to queue. The changes will not be visible on the' +
                ' Shopify store until the next scheduled sync.');
            console.error(error);
        }

        callback();
    })

};
