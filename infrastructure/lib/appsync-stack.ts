import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AppSyncStackProps extends cdk.StackProps {
  usersTable: dynamodb.Table;
  showSetsTable: dynamodb.Table;
  sessionsTable: dynamodb.Table;
  userPool: cognito.UserPool;
}

export class AppSyncStack extends cdk.Stack {
  public readonly graphqlUrl: string;
  public readonly realtimeUrl: string;

  constructor(scope: Construct, id: string, props: AppSyncStackProps) {
    super(scope, id, props);

    // Create the AppSync API
    const api = new appsync.GraphqlApi(this, 'UnisyncApi', {
      name: 'unisync-graphql-api',
      definition: appsync.Definition.fromFile(
        path.join(__dirname, '../graphql/schema.graphql')
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: props.userPool,
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: appsync.AuthorizationType.IAM,
          },
        ],
      },
      xrayEnabled: true,
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ERROR,
      },
    });

    this.graphqlUrl = api.graphqlUrl;
    this.realtimeUrl = `wss://${api.graphqlUrl.replace('https://', '').replace('/graphql', '')}/graphql/realtime`;

    // Create DynamoDB data sources
    const showSetsDataSource = api.addDynamoDbDataSource(
      'ShowSetsDataSource',
      props.showSetsTable
    );

    const sessionsDataSource = api.addDynamoDbDataSource(
      'SessionsDataSource',
      props.sessionsTable
    );

    // Users data source - reserved for future user queries
    api.addDynamoDbDataSource('UsersDataSource', props.usersTable);

    // None data source for subscriptions
    const noneDataSource = api.addNoneDataSource('NoneDataSource');

    // ===== QUERY RESOLVERS =====

    // listShowSets query
    showSetsDataSource.createResolver('ListShowSetsResolver', {
      typeName: 'Query',
      fieldName: 'listShowSets',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($ctx.args.area)
          {
            "version": "2018-05-29",
            "operation": "Query",
            "index": "GSI1-area-index",
            "query": {
              "expression": "GSI1PK = :pk",
              "expressionValues": {
                ":pk": { "S": "AREA#$ctx.args.area" }
              }
            }
          }
        #else
          {
            "version": "2018-05-29",
            "operation": "Scan"
          }
        #end
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($items = [])
        #foreach($item in $ctx.result.items)
          #if($item.SK == "DETAILS")
            $util.qr($items.add($item))
          #end
        #end
        $util.toJson($items)
      `),
    });

    // getShowSet query
    showSetsDataSource.createResolver('GetShowSetResolver', {
      typeName: 'Query',
      fieldName: 'getShowSet',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2018-05-29",
          "operation": "GetItem",
          "key": {
            "PK": { "S": "SHOWSET#$ctx.args.showSetId" },
            "SK": { "S": "DETAILS" }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // listSessions query
    sessionsDataSource.createResolver('ListSessionsResolver', {
      typeName: 'Query',
      fieldName: 'listSessions',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2018-05-29",
          "operation": "Query",
          "query": {
            "expression": "PK = :pk",
            "expressionValues": {
              ":pk": { "S": "ACTIVE_SESSION" }
            }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        $util.toJson($ctx.result.items)
      `),
    });

    // ===== MUTATION RESOLVERS =====

    // updateStage mutation
    showSetsDataSource.createResolver('UpdateStageResolver', {
      typeName: 'Mutation',
      fieldName: 'updateStage',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($now = $util.time.nowISO8601())
        #set($userId = $ctx.identity.sub)

        {
          "version": "2018-05-29",
          "operation": "UpdateItem",
          "key": {
            "PK": { "S": "SHOWSET#$ctx.args.showSetId" },
            "SK": { "S": "DETAILS" }
          },
          "update": {
            "expression": "SET stages.#stage.#status = :status, stages.#stage.updatedBy = :userId, stages.#stage.updatedAt = :now, updatedAt = :now",
            "expressionNames": {
              "#stage": "$ctx.args.stage",
              "#status": "status"
            },
            "expressionValues": {
              ":status": { "S": "$ctx.args.input.status" },
              ":userId": { "S": "$userId" },
              ":now": { "S": "$now" }
            }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // updateLinks mutation
    showSetsDataSource.createResolver('UpdateLinksResolver', {
      typeName: 'Mutation',
      fieldName: 'updateLinks',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($now = $util.time.nowISO8601())

        {
          "version": "2018-05-29",
          "operation": "UpdateItem",
          "key": {
            "PK": { "S": "SHOWSET#$ctx.args.showSetId" },
            "SK": { "S": "DETAILS" }
          },
          "update": {
            "expression": "SET links.modelUrl = :modelUrl, links.drawingsUrl = :drawingsUrl, updatedAt = :now",
            "expressionValues": {
              ":modelUrl": $util.dynamodb.toDynamoDBJson($ctx.args.input.modelUrl),
              ":drawingsUrl": $util.dynamodb.toDynamoDBJson($ctx.args.input.drawingsUrl),
              ":now": { "S": "$now" }
            }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // updateVersion mutation
    showSetsDataSource.createResolver('UpdateVersionResolver', {
      typeName: 'Mutation',
      fieldName: 'updateVersion',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($now = $util.time.nowISO8601())
        #set($versionType = $ctx.args.input.versionType)

        {
          "version": "2018-05-29",
          "operation": "UpdateItem",
          "key": {
            "PK": { "S": "SHOWSET#$ctx.args.showSetId" },
            "SK": { "S": "DETAILS" }
          },
          "update": {
            "expression": "SET #versionType = :version, updatedAt = :now",
            "expressionNames": {
              "#versionType": "$versionType"
            },
            "expressionValues": {
              ":version": { "N": "$ctx.args.input.targetVersion" },
              ":now": { "S": "$now" }
            }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // startSession mutation
    sessionsDataSource.createResolver('StartSessionResolver', {
      typeName: 'Mutation',
      fieldName: 'startSession',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($now = $util.time.nowISO8601())
        #set($userId = $ctx.identity.sub)
        #set($userName = $ctx.identity.claims.get("name"))
        #if(!$userName)
          #set($userName = $ctx.identity.claims.get("email"))
        #end
        #set($ttl = $util.time.nowEpochSeconds() + 300)

        #set($workingStages = [])
        #if($ctx.args.input.workingStages)
          #set($workingStages = $ctx.args.input.workingStages)
        #end

        {
          "version": "2018-05-29",
          "operation": "PutItem",
          "key": {
            "PK": { "S": "ACTIVE_SESSION" },
            "SK": { "S": "USER#$userId" }
          },
          "attributeValues": {
            "userId": { "S": "$userId" },
            "userName": { "S": "$userName" },
            "showSetId": $util.dynamodb.toDynamoDBJson($ctx.args.input.showSetId),
            "workingStages": $util.dynamodb.toDynamoDBJson($workingStages),
            "activity": { "S": "$ctx.args.input.activity" },
            "startedAt": { "S": "$now" },
            "lastHeartbeat": { "S": "$now" },
            "expiresAt": { "N": "$ttl" }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // endSession mutation
    sessionsDataSource.createResolver('EndSessionResolver', {
      typeName: 'Mutation',
      fieldName: 'endSession',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($userId = $ctx.identity.sub)

        {
          "version": "2018-05-29",
          "operation": "DeleteItem",
          "key": {
            "PK": { "S": "ACTIVE_SESSION" },
            "SK": { "S": "USER#$userId" }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        true
      `),
    });

    // heartbeat mutation
    sessionsDataSource.createResolver('HeartbeatResolver', {
      typeName: 'Mutation',
      fieldName: 'heartbeat',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($now = $util.time.nowISO8601())
        #set($userId = $ctx.identity.sub)
        #set($ttl = $util.time.nowEpochSeconds() + 300)

        #set($updateExpression = "SET lastHeartbeat = :now, expiresAt = :ttl")
        #set($expressionValues = {
          ":now": { "S": "$now" },
          ":ttl": { "N": "$ttl" }
        })

        #if($ctx.args.activity)
          #set($updateExpression = "$updateExpression, activity = :activity")
          $util.qr($expressionValues.put(":activity", { "S": "$ctx.args.activity" }))
        #end

        #if($ctx.args.showSetId)
          #set($updateExpression = "$updateExpression, showSetId = :showSetId")
          $util.qr($expressionValues.put(":showSetId", { "S": "$ctx.args.showSetId" }))
        #end

        {
          "version": "2018-05-29",
          "operation": "UpdateItem",
          "key": {
            "PK": { "S": "ACTIVE_SESSION" },
            "SK": { "S": "USER#$userId" }
          },
          "update": {
            "expression": "$updateExpression",
            "expressionValues": $util.toJson($expressionValues)
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        true
      `),
    });

    // ===== SUBSCRIPTION RESOLVERS =====
    // Subscriptions are automatically handled by AppSync using @aws_subscribe directive

    noneDataSource.createResolver('OnShowSetUpdatedResolver', {
      typeName: 'Subscription',
      fieldName: 'onShowSetUpdated',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2018-05-29",
          "payload": $util.toJson($ctx.args)
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        $util.toJson($ctx.result)
      `),
    });

    noneDataSource.createResolver('OnSessionChangedResolver', {
      typeName: 'Subscription',
      fieldName: 'onSessionChanged',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2018-05-29",
          "payload": {}
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        $util.toJson($ctx.result)
      `),
    });

    // Outputs
    new cdk.CfnOutput(this, 'GraphQLUrl', {
      value: api.graphqlUrl,
      exportName: 'unisync-graphql-url',
    });

    new cdk.CfnOutput(this, 'RealtimeUrl', {
      value: this.realtimeUrl,
      exportName: 'unisync-realtime-url',
    });

    new cdk.CfnOutput(this, 'GraphQLApiId', {
      value: api.apiId,
      exportName: 'unisync-graphql-api-id',
    });
  }
}
