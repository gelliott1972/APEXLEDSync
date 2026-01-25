import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TranslationStackProps extends cdk.StackProps {
  notesTable: dynamodb.Table;
  attachmentsBucket?: s3.Bucket;
}

export class TranslationStack extends cdk.Stack {
  public readonly translationQueue: sqs.Queue;
  public readonly translationDLQ: sqs.Queue;
  public readonly pdfTranslationQueue: sqs.Queue;
  public readonly pdfTranslationDLQ: sqs.Queue;

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

    // === PDF Translation Resources ===

    // Dead Letter Queue for failed PDF translations
    this.pdfTranslationDLQ = new sqs.Queue(this, 'PdfTranslationDLQ', {
      queueName: 'unisync-pdf-translation-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // PDF translation queue (longer visibility timeout for Textract processing)
    this.pdfTranslationQueue = new sqs.Queue(this, 'PdfTranslationQueue', {
      queueName: 'unisync-pdf-translation-queue',
      visibilityTimeout: cdk.Duration.seconds(180), // 3 minutes for PDF processing
      deadLetterQueue: {
        queue: this.pdfTranslationDLQ,
        maxReceiveCount: 3,
      },
    });

    // PDF Translation Lambda function
    const pdfTranslationHandler = new lambda.Function(this, 'PdfTranslationHandler', {
      functionName: 'unisync-pdf-translation-handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../apps/backend/dist/handlers/pdf-translate')),
      timeout: cdk.Duration.seconds(120), // 2 minutes timeout
      memorySize: 512, // More memory for PDF processing
      environment: {
        NOTES_TABLE: props.notesTable.tableName,
        ATTACHMENTS_BUCKET: props.attachmentsBucket?.bucketName ?? '',
      },
    });

    // Grant DynamoDB permissions
    props.notesTable.grantReadWriteData(pdfTranslationHandler);

    // Grant S3 read permissions for attachments bucket
    if (props.attachmentsBucket) {
      props.attachmentsBucket.grantRead(pdfTranslationHandler);
    }

    // Grant Textract permissions
    pdfTranslationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['textract:DetectDocumentText', 'textract:AnalyzeDocument'],
        resources: ['*'],
      })
    );

    // Grant Comprehend permissions
    pdfTranslationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['comprehend:DetectDominantLanguage'],
        resources: ['*'],
      })
    );

    // Grant AWS Translate permissions
    pdfTranslationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['translate:TranslateText'],
        resources: ['*'],
      })
    );

    // Add SQS event source for PDF translation
    pdfTranslationHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(this.pdfTranslationQueue, {
        batchSize: 1, // Process one PDF at a time
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

    new cdk.CfnOutput(this, 'PdfTranslationQueueUrl', {
      value: this.pdfTranslationQueue.queueUrl,
      exportName: 'unisync-pdf-translation-queue-url',
    });

    new cdk.CfnOutput(this, 'PdfTranslationQueueArn', {
      value: this.pdfTranslationQueue.queueArn,
      exportName: 'unisync-pdf-translation-queue-arn',
    });
  }
}
