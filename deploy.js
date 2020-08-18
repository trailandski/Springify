const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const AWS = require('aws-sdk');

/**
 * @property awsStackName
 * @property awsRegion
 */
const config = JSON.parse(readFileSync(`configs/${process.argv[2]}.json`).toString());

AWS.config.region = config.awsRegion;

function deployToAWS() {
    let stringifiedArgs = '';

    for (const [key, value] of Object.entries(config.samArgs)) {
        stringifiedArgs += `${key}=\"${value}\" `;
    }

    const deployCommand = [];
    deployCommand.push(
        'sam deploy',
        '--no-confirm-changeset',
        `--parameter-overrides ${stringifiedArgs}`,
        `--stack-name ${config.awsStackName}`,
        `--s3-prefix ${config.awsStackName}`,
        `--region ${config.awsRegion}`
    );


    const output = execSync(deployCommand.join(' ')).toString();
    console.log(output);
}

async function invokePostDeploymentHook() {
    // Get the name of the function.
    const cloudFormation = new AWS.CloudFormation();
    const stack = (await cloudFormation.describeStacks({
        StackName: config.awsStackName
    }).promise()).Stacks[0];

    // Invoke the function.
    const lambda = new AWS.Lambda();

    await lambda.invoke({
        FunctionName: stack.Outputs.find(output => output.OutputKey === 'AWSDeploymentListener').OutputValue,
        InvocationType: 'RequestResponse',
        LogType: 'Tail',
    }).promise();
}


(async () => {
    try {
        deployToAWS();
    } catch (error) {
        if (!error.message.includes('No changes to deploy.')) {
            throw error;
        }
    }


   try {
       await invokePostDeploymentHook();
   } catch (error) {
       console.error(error)
   }

})();
