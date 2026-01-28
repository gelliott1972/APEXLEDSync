import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly usersTable: dynamodb.Table;
  public readonly showSetsTable: dynamodb.Table;
  public readonly notesTable: dynamodb.Table;
  public readonly activityTable: dynamodb.Table;
  public readonly sessionsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Users Table
    this.usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'unisync-users',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // GSI for email lookup
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'GSI1-email-index',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ShowSets Table
    this.showSetsTable = new dynamodb.Table(this, 'ShowSetsTable', {
      tableName: 'unisync-showsets',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // GSI for area lookup
    this.showSetsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1-area-index',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Notes/Issues Table
    this.notesTable = new dynamodb.Table(this, 'NotesTable', {
      tableName: 'unisync-notes',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // NOTE: GSI1-author-index and GSI2-mention-index were added manually via AWS CLI
    // (DynamoDB only allows one GSI creation per update)
    // Do NOT add them here or CDK will try to recreate them and fail.
    // See issues_part1.md for details.

    // Activity Table
    this.activityTable = new dynamodb.Table(this, 'ActivityTable', {
      tableName: 'unisync-activity',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // GSI for recent activity across all ShowSets
    this.activityTable.addGlobalSecondaryIndex({
      indexName: 'GSI1-date-index',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Sessions Table
    this.sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: 'unisync-sessions',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Sessions are ephemeral
      timeToLiveAttribute: 'expiresAt',
    });

    // Outputs
    new cdk.CfnOutput(this, 'UsersTableName', {
      value: this.usersTable.tableName,
      exportName: 'unisync-users-table-name',
    });

    new cdk.CfnOutput(this, 'ShowSetsTableName', {
      value: this.showSetsTable.tableName,
      exportName: 'unisync-showsets-table-name',
    });

    new cdk.CfnOutput(this, 'NotesTableName', {
      value: this.notesTable.tableName,
      exportName: 'unisync-notes-table-name',
    });

    new cdk.CfnOutput(this, 'ActivityTableName', {
      value: this.activityTable.tableName,
      exportName: 'unisync-activity-table-name',
    });

    new cdk.CfnOutput(this, 'SessionsTableName', {
      value: this.sessionsTable.tableName,
      exportName: 'unisync-sessions-table-name',
    });
  }
}
