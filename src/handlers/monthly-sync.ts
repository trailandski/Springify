import { Handler }  from 'aws-lambda';
import * as springboardPageTools from 'springboard-pagination-tool';
import * as AWS from 'aws-sdk';
import { addItemsToQueue } from './daily-sync';

export const performMonthlySync: Handler = async (event, context) => {
    let itemFilter = {};

    if (event.itemFilter) {
        itemFilter = event.itemFilter
    }

    const springboardCredentials = {
        token: process.env.SpringboardToken,
        subDomain: process.env.SpringboardSubDomain
    };

    let getPagePromise;

    if (event.next) {
        getPagePromise = springboardPageTools.getPage(springboardCredentials, event.next);
    } else {
        getPagePromise = springboardPageTools
            .getFirstPage(springboardCredentials, 'items?_include[]=grid&_filter=' + encodeURIComponent(JSON.stringify(itemFilter)));
    }
    const page = await getPagePromise;

    await addItemsToQueue(page.elements);

    if (page.next) {
        try {
            await recurse(page.next)
        } catch (error) {
            console.log(error);
        }
    }
};

const recurse = (next) => {
    const lambda = new AWS.Lambda();

    console.info('Launching new instance to read next page of Springboard items.');

    return lambda.invoke({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        LogType: 'Tail',
        InvocationType: 'Event',
        Payload: JSON.stringify({
            next
        })
    }).promise();
};
