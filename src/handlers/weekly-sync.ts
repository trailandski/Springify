import { Handler }  from 'aws-lambda';
import * as springboard from 'springboard-pagination-tool';

export const addAllItemsToQueue: Handler = (event, context, callback) => {
    const firstPage = springboard.getFirstPage();
};
