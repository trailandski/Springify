import { Handler } from 'aws-lambda';
import * as springboard from 'springboard-pagination-tool';
import * as AWS from 'aws-sdk';

export const performDailySync: Handler = (event, context, callback) => {
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

    const sqs = new AWS.SQS();

    springboard.iteratePages(springboardCredentials, `items?_filter=` + encodeURIComponent(JSON.stringify(filter)), (items, cancel) => {
        while (items.length > 0) {
            // SQS has a max batch size of ten messages.
            const accumulator = [];
            for (let i = 0; i < 10; i++) {
                if (items.length > 0) {
                    accumulator.push(items.pop())
                }
            }
            const Entries = accumulator.map(item => ({
                Id: item.id.toString(),
                MessageBody: JSON.stringify(item),
                MessageDeduplicationId: `${item.id}${item.updated_at}`,
                MessageGroupId: 'SpringboardItemUpdate'
            }));

            sqs.sendMessageBatch({
                QueueUrl: process.env.QueueUrl,
                Entries
            }, (error, data) => {
                if (error) {
                    console.warn('Failed to add items to queue. Something is very wrong. Halting...');
                    console.log(error);
                    // Cancel iteration
                    cancel();
                }

                if (data.Failed.length > 0) {
                    console.warn('Failed to add one or more items to the queue. Something is very wrong. Halting...');
                    console.error(data.Failed);
                    // Cancel iteration
                    cancel();
                }
            })
        }
    }).then(() => callback());
};
