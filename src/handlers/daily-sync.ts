import { Handler } from 'aws-lambda';
import * as springboardPageTools from 'springboard-pagination-tool';
import { attachItemDetails } from '../springboard';
import * as AWS from 'aws-sdk';

export const addItemsToQueue = async (items) => {
    const sqs = new AWS.SQS();

    let batch = 1;

    while (items.length > 0) {
        // SQS has a max batch size of ten messages.
        const accumulator = [];
        for (let i = 0; i < 10; i++) {
            if (items.length > 0) {
                const item = items.pop();
                console.debug(item);
                await attachItemDetails(item);
                console.debug(item);
                accumulator.push(item);
            }
        }
        const Entries = accumulator.map(item => ({
            Id: item.id.toString(),
            MessageBody: JSON.stringify(item),
            MessageDeduplicationId: `${item.id}${item.updated_at}`,
            MessageGroupId: 'SpringboardItemUpdate'
        }));

        console.debug(`Sending Batch #${batch++}...`);

        try {
            const data = await sqs.sendMessageBatch({
                QueueUrl: process.env.QueueUrl,
                Entries
            }).promise();

            if (data.Failed.length > 0) {
                console.warn('Failed to add one or more items to the queue. Something is very wrong. Halting...');
                console.error(data.Failed);
            }
        } catch (error) {
            console.warn('Failed to add items to queue. Something is very wrong. Halting...');
            console.log(error);
            return;
        }
    }
};

export const performDailySync: Handler = async (event, context) => {
    // 24 hours ago.
    const lastSyncOccurred = Date.now() - (1000 * 60 * 60 * 24);

    // Get all items that have been modified since the last daily sync.
    const filter = {
        updated_at: {
            '$gt': new Date(lastSyncOccurred).toISOString()
        }
    };

    const springboardCredentials = {
        token: process.env.SpringboardToken,
        subDomain: process.env.SpringboardSubDomain
    };

    await springboardPageTools.iteratePages(springboardCredentials, `items?_include[]=grid&_filter=` + encodeURIComponent(JSON.stringify(filter)), addItemsToQueue);
};
