const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const AWS = require('aws-sdk');

/**
 * @property awsStackName
 * @property awsRegion
 * @property samArgs
 */
const instance = JSON.parse(readFileSync(`instances/${process.argv[2]}.json`).toString());

AWS.config.region = instance.awsRegion;

function deployToAWS() {
    let stringifiedArgs = '';

    for (const [key, value] of Object.entries(instance.samArgs)) {
        stringifiedArgs += `${key}=\"${value}\" `;
    }

    const deployCommand = [];
    deployCommand.push(
        'sam deploy',
        '--no-confirm-changeset',
        `--parameter-overrides ${stringifiedArgs}`,
        `--stack-name ${instance.awsStackName}`,
        `--s3-prefix ${instance.awsStackName}`,
        `--region ${instance.awsRegion}`
    );


    const output = execSync(deployCommand.join(' ')).toString();
    console.log(output);
}

async function invokePostDeploymentHook() {
    // Get the name of the function.
    const cloudFormation = new AWS.CloudFormation();
    const stack = (await cloudFormation.describeStacks({
        StackName: instance.awsStackName
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
