#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { FrontendStack } from '../lib/frontend-stack.js';
import { TranslationStack } from '../lib/translation-stack.js';

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

// Translation stack - SQS queue and Lambda
const translationStack = new TranslationStack(app, 'UnisyncTranslationStack', {
  env,
  description: 'UniSync translation service',
  notesTable: databaseStack.notesTable,
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
});

// Frontend stack - S3 and CloudFront
new FrontendStack(app, 'UnisyncFrontendStack', {
  env,
  description: 'UniSync frontend hosting',
  apiUrl: apiStack.apiUrl,
  userPoolId: authStack.userPool.userPoolId,
  userPoolClientId: authStack.userPoolClient.userPoolClientId,
});

app.synth();
