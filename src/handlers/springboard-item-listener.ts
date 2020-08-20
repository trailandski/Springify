import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import { attachItemDetails, attachItemGrid } from '../springboard';

export const springboardDidSendItemEvent: APIGatewayProxyHandlerV2 = async (event, context, callback) => {
    const sqs = new AWS.SQS();
    const item = JSON.parse(event.body!);

    await attachItemDetails(item);
    await attachItemGrid(item);

    try {
        await sqs.sendMessage({
            QueueUrl: process.env.QueueUrl!,
            MessageGroupId: 'SpringboardItemUpdate',
            MessageBody: JSON.stringify(item),
            MessageDeduplicationId: `${item.id}${item.updated_at}`
        }).promise();
    } catch (error) {
        console.warn('Failed to add item update event to queue. The changes will not be visible on the' +
            ' Shopify store until the next scheduled sync.');
        console.error(error);

        // Instruct Springboard to retry this event in a little white.
        // Hopefully the issue will be fixed by then.
        return { statusCode: 400 };
    }

    // We successfully recorded the item update event.
    return { statusCode: 200 };
};
