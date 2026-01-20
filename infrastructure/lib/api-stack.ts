import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ApiStackProps extends cdk.StackProps {
  usersTable: dynamodb.Table;
  showSetsTable: dynamodb.Table;
  notesTable: dynamodb.Table;
  activityTable: dynamodb.Table;
  sessionsTable: dynamodb.Table;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  translationQueue: sqs.Queue;
  attachmentsBucket: s3.Bucket;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // API Gateway
    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'unisync-api',
      description: 'UniSync API',
      deployOptions: {
        stageName: 'v1',
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
    });

    this.apiUrl = this.api.url;

    // Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'unisync-cognito-authorizer',
    });

    // Common environment variables for all handlers
    const commonEnv = {
      USERS_TABLE: props.usersTable.tableName,
      SHOWSETS_TABLE: props.showSetsTable.tableName,
      NOTES_TABLE: props.notesTable.tableName,
      ACTIVITY_TABLE: props.activityTable.tableName,
      SESSIONS_TABLE: props.sessionsTable.tableName,
      TRANSLATION_QUEUE_URL: props.translationQueue.queueUrl,
      USER_POOL_ID: props.userPool.userPoolId,
      ATTACHMENTS_BUCKET: props.attachmentsBucket.bucketName,
    };

    // Helper to create Lambda functions
    const createHandler = (name: string, handlerPath: string): lambda.Function => {
      const fn = new lambda.Function(this, `${name}Handler`, {
        functionName: `unisync-${name.toLowerCase()}`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(
          path.join(__dirname, `../../apps/backend/dist/handlers/${handlerPath}`)
        ),
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        environment: commonEnv,
      });

      // Grant DynamoDB permissions
      props.usersTable.grantReadWriteData(fn);
      props.showSetsTable.grantReadWriteData(fn);
      props.notesTable.grantReadWriteData(fn);
      props.activityTable.grantReadWriteData(fn);
      props.sessionsTable.grantReadWriteData(fn);

      return fn;
    };

    // Auth handler
    const authHandler = createHandler('Auth', 'auth');

    // ShowSets handler
    const showSetsHandler = createHandler('ShowSets', 'showsets');
    props.translationQueue.grantSendMessages(showSetsHandler); // For revision notes

    // Notes handler
    const notesHandler = createHandler('Notes', 'notes');
    props.translationQueue.grantSendMessages(notesHandler);
    props.attachmentsBucket.grantReadWrite(notesHandler);

    // Sessions handler
    const sessionsHandler = createHandler('Sessions', 'sessions');

    // Users handler (Admin only)
    const usersHandler = createHandler('Users', 'users');
    // Grant Cognito admin permissions
    usersHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminGetUser',
        ],
        resources: [props.userPool.userPoolArn],
      })
    );

    // Activity handler
    const activityHandler = createHandler('Activity', 'activity');

    // Translate API handler (synchronous translation)
    const translateApiHandler = createHandler('TranslateApi', 'translate-api');
    translateApiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['translate:TranslateText'],
        resources: ['*'],
      })
    );

    // Health check handler (no auth) - uses CommonJS for inline code
    const healthHandler = new lambda.Function(this, 'HealthHandler', {
      functionName: 'unisync-health',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async () => ({
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }),
        });
      `),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
    });

    // Lambda integrations
    const authIntegration = new apigateway.LambdaIntegration(authHandler);
    const showSetsIntegration = new apigateway.LambdaIntegration(showSetsHandler);
    const notesIntegration = new apigateway.LambdaIntegration(notesHandler);
    const sessionsIntegration = new apigateway.LambdaIntegration(sessionsHandler);
    const usersIntegration = new apigateway.LambdaIntegration(usersHandler);
    const activityIntegration = new apigateway.LambdaIntegration(activityHandler);
    const translateApiIntegration = new apigateway.LambdaIntegration(translateApiHandler);
    const healthIntegration = new apigateway.LambdaIntegration(healthHandler);

    const authOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // Health endpoint (no auth)
    const health = this.api.root.addResource('health');
    health.addMethod('GET', healthIntegration);

    // Auth endpoints
    const auth = this.api.root.addResource('auth');
    const updateProfile = auth.addResource('update-profile');
    updateProfile.addMethod('POST', authIntegration, authOptions);

    // ShowSets endpoints
    const showSets = this.api.root.addResource('showsets');
    showSets.addMethod('GET', showSetsIntegration, authOptions);
    showSets.addMethod('POST', showSetsIntegration, authOptions);

    const showSetById = showSets.addResource('{id}');
    showSetById.addMethod('GET', showSetsIntegration, authOptions);
    showSetById.addMethod('PUT', showSetsIntegration, authOptions);
    showSetById.addMethod('DELETE', showSetsIntegration, authOptions);

    const stage = showSetById.addResource('stage');
    const stageByName = stage.addResource('{stage}');
    stageByName.addMethod('PUT', showSetsIntegration, authOptions);

    const links = showSetById.addResource('links');
    links.addMethod('PUT', showSetsIntegration, authOptions);

    const version = showSetById.addResource('version');
    version.addMethod('PUT', showSetsIntegration, authOptions);

    const lock = showSetById.addResource('lock');
    lock.addMethod('POST', showSetsIntegration, authOptions);

    const unlock = showSetById.addResource('unlock');
    unlock.addMethod('POST', showSetsIntegration, authOptions);

    // Notes endpoints
    const showSetNotes = showSetById.addResource('notes');
    showSetNotes.addMethod('GET', notesIntegration, authOptions);
    showSetNotes.addMethod('POST', notesIntegration, authOptions);

    const notes = this.api.root.addResource('notes');
    const noteById = notes.addResource('{noteId}');
    noteById.addMethod('PUT', notesIntegration, authOptions);
    noteById.addMethod('DELETE', notesIntegration, authOptions);

    // Note attachments
    const attachments = noteById.addResource('attachments');
    const presign = attachments.addResource('presign');
    presign.addMethod('POST', notesIntegration, authOptions);

    const attachmentById = attachments.addResource('{attachmentId}');
    attachmentById.addMethod('GET', notesIntegration, authOptions);
    attachmentById.addMethod('DELETE', notesIntegration, authOptions);

    const confirmAttachment = attachmentById.addResource('confirm');
    confirmAttachment.addMethod('POST', notesIntegration, authOptions);

    // Activity endpoints
    const showSetActivity = showSetById.addResource('activity');
    showSetActivity.addMethod('GET', activityIntegration, authOptions);

    const activity = this.api.root.addResource('activity');
    const recentActivity = activity.addResource('recent');
    recentActivity.addMethod('GET', activityIntegration, authOptions);

    // Sessions endpoints
    const sessions = this.api.root.addResource('sessions');
    sessions.addMethod('GET', sessionsIntegration, authOptions);

    const sessionStart = sessions.addResource('start');
    sessionStart.addMethod('POST', sessionsIntegration, authOptions);

    const sessionHeartbeat = sessions.addResource('heartbeat');
    sessionHeartbeat.addMethod('POST', sessionsIntegration, authOptions);

    const sessionEnd = sessions.addResource('end');
    sessionEnd.addMethod('POST', sessionsIntegration, authOptions);

    // Translate endpoint
    const translate = this.api.root.addResource('translate');
    translate.addMethod('POST', translateApiIntegration, authOptions);

    // Users endpoints (Admin only)
    const users = this.api.root.addResource('users');
    users.addMethod('GET', usersIntegration, authOptions);
    users.addMethod('POST', usersIntegration, authOptions);

    const userById = users.addResource('{userId}');
    userById.addMethod('GET', usersIntegration, authOptions);
    userById.addMethod('PUT', usersIntegration, authOptions);
    userById.addMethod('DELETE', usersIntegration, authOptions);

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      exportName: 'unisync-api-url',
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      exportName: 'unisync-api-id',
    });
  }
}
