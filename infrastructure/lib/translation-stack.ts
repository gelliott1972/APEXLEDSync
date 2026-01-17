import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TranslationStackProps extends cdk.StackProps {
  notesTable: dynamodb.Table;
}

export class TranslationStack extends cdk.Stack {
  public readonly translationQueue: sqs.Queue;
  public readonly translationDLQ: sqs.Queue;

  constructor(scope: Construct, id: string, props: TranslationStackProps) {
    super(scope, id, props);

    // Dead Letter Queue for failed translations
    this.translationDLQ = new sqs.Queue(this, 'TranslationDLQ', {
      queueName: 'unisync-translation-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Main translation queue
    this.translationQueue = new sqs.Queue(this, 'TranslationQueue', {
      queueName: 'unisync-translation-queue',
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: this.translationDLQ,
        maxReceiveCount: 3,
      },
    });

    // Translation Lambda function
    const translationHandler = new lambda.Function(this, 'TranslationHandler', {
      functionName: 'unisync-translation-handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/backend/dist/handlers/translate')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        NOTES_TABLE: props.notesTable.tableName,
      },
    });

    // Grant DynamoDB permissions
    props.notesTable.grantReadWriteData(translationHandler);

    // Grant AWS Translate permissions
    translationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['translate:TranslateText'],
        resources: ['*'],
      })
    );

    // Add SQS event source
    translationHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(this.translationQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'TranslationQueueUrl', {
      value: this.translationQueue.queueUrl,
      exportName: 'unisync-translation-queue-url',
    });

    new cdk.CfnOutput(this, 'TranslationQueueArn', {
      value: this.translationQueue.queueArn,
      exportName: 'unisync-translation-queue-arn',
    });
  }
}
