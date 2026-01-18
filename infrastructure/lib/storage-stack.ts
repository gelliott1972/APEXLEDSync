import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export class StorageStack extends cdk.Stack {
  public readonly attachmentsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for note attachments
    this.attachmentsBucket = new s3.Bucket(this, 'AttachmentsBucket', {
      bucketName: `unisync-attachments-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,

      // Block public access
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      // CORS configuration for presigned URL uploads
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],

      // Lifecycle rules
      lifecycleRules: [
        {
          id: 'DeleteOldAttachments',
          enabled: false, // Enable if you want auto-expiration
          expiration: cdk.Duration.days(365),
        },
      ],

      // Encryption
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Output the bucket name
    new cdk.CfnOutput(this, 'AttachmentsBucketName', {
      value: this.attachmentsBucket.bucketName,
      description: 'S3 bucket for note attachments',
      exportName: 'UnisyncAttachmentsBucketName',
    });
  }
}
