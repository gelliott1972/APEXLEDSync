#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { AppSyncStack } from '../lib/appsync-stack.js';
import { FrontendStack } from '../lib/frontend-stack.js';
import { TranslationStack } from '../lib/translation-stack.js';
import { StorageStack } from '../lib/storage-stack.js';
import { PreviewStack } from '../lib/preview-stack.js';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-east-1',
};

// Database stack - DynamoDB tables
const databaseStack = new DatabaseStack(app, 'UnisyncDatabaseStack', {
  env,
  description: 'UniSync DynamoDB tables',
});

// Auth stack - Cognito
const authStack = new AuthStack(app, 'UnisyncAuthStack', {
  env,
  description: 'UniSync Cognito authentication',
});

// Storage stack - S3 bucket for attachments (before translation stack so bucket is available)
const storageStack = new StorageStack(app, 'UnisyncStorageStack', {
  env,
  description: 'UniSync file storage',
});

// Translation stack - SQS queue and Lambda
const translationStack = new TranslationStack(app, 'UnisyncTranslationStack', {
  env,
  description: 'UniSync translation service',
  notesTable: databaseStack.notesTable,
  attachmentsBucket: storageStack.attachmentsBucket,
});

// API stack - API Gateway and Lambda functions
const apiStack = new ApiStack(app, 'UnisyncApiStack', {
  env,
  description: 'UniSync API Gateway and Lambda functions',
  usersTable: databaseStack.usersTable,
  showSetsTable: databaseStack.showSetsTable,
  notesTable: databaseStack.notesTable,
  activityTable: databaseStack.activityTable,
  sessionsTable: databaseStack.sessionsTable,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  translationQueue: translationStack.translationQueue,
  pdfTranslationQueue: translationStack.pdfTranslationQueue,
  attachmentsBucket: storageStack.attachmentsBucket,
});

// AppSync stack - GraphQL API with real-time subscriptions
new AppSyncStack(app, 'UnisyncAppSyncStack', {
  env,
  description: 'UniSync GraphQL API with real-time subscriptions',
  usersTable: databaseStack.usersTable,
  showSetsTable: databaseStack.showSetsTable,
  sessionsTable: databaseStack.sessionsTable,
  userPool: authStack.userPool,
});

// Custom domain configuration (optional)
const domainName = app.node.tryGetContext('domainName') ?? process.env.DOMAIN_NAME;
const certificateArn = app.node.tryGetContext('certificateArn') ?? process.env.CERTIFICATE_ARN;
const hostedZoneId = app.node.tryGetContext('hostedZoneId') ?? process.env.HOSTED_ZONE_ID;

// Frontend stack - S3 and CloudFront
new FrontendStack(app, 'UnisyncFrontendStack', {
  env,
  description: 'UniSync frontend hosting',
  apiUrl: apiStack.apiUrl,
  userPoolId: authStack.userPool.userPoolId,
  userPoolClientId: authStack.userPoolClient.userPoolClientId,
  // Custom domain (optional)
  domainName,
  certificateArn,
  hostedZoneId,
});

// Preview stack - Branch-based preview deployments (optional)
// Only create if wildcard certificate is available
if (domainName && certificateArn && hostedZoneId) {
  new PreviewStack(app, 'UnisyncPreviewStack', {
    env,
    description: 'UniSync preview deployments for feature branches',
    baseDomain: domainName,
    wildcardCertificateArn: certificateArn,
    hostedZoneId,
  });
}

app.synth();
