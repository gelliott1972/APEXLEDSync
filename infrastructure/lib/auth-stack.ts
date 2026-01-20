import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'unisync-user-pool',
      selfSignUpEnabled: false, // Admin creates users
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        fullname: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        userId: new cognito.StringAttribute({ mutable: false }),
        role: new cognito.StringAttribute({ mutable: true }),
        preferredLang: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'unisync-web-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Admin group
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'unisync-admin',
      description: 'Administrators with full access',
    });

    // BIM Coordinator group
    new cognito.CfnUserPoolGroup(this, 'BimCoordinatorGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'unisync-bim_coordinator',
      description: 'BIM Coordinators',
    });

    // Engineer group
    new cognito.CfnUserPoolGroup(this, 'EngineerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'unisync-engineer',
      description: 'Engineers',
    });

    // 3D Modeller group
    new cognito.CfnUserPoolGroup(this, 'ModellerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'unisync-3d_modeller',
      description: '3D Modellers',
    });

    // 2D Drafter group
    new cognito.CfnUserPoolGroup(this, 'DrafterGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'unisync-2d_drafter',
      description: '2D Drafters',
    });

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: 'unisync-user-pool-id',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: 'unisync-user-pool-client-id',
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      exportName: 'unisync-user-pool-arn',
    });
  }
}
