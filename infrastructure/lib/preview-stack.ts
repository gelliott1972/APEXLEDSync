/**
 * Preview Stack - Branch-based preview deployments
 *
 * Deploys feature branches to subdomains like:
 *   feature-notes-to-issues.apex.wrangleit.net
 *
 * Uses a CloudFront Function to route subdomain requests to the correct S3 prefix.
 */
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import type { Construct } from 'constructs';

interface PreviewStackProps extends cdk.StackProps {
  baseDomain: string; // e.g., 'apex.wrangleit.net'
  wildcardCertificateArn: string; // Must cover *.apex.wrangleit.net
  hostedZoneId: string;
}

export class PreviewStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: PreviewStackProps) {
    super(scope, id, props);

    // S3 bucket for preview deployments
    // Each branch deploys to /{branch-name}/ prefix
    this.bucket = new s3.Bucket(this, 'PreviewBucket', {
      bucketName: `unisync-preview-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // Lifecycle rule to clean up old previews
      lifecycleRules: [
        {
          id: 'cleanup-old-previews',
          prefix: '',
          expiration: cdk.Duration.days(30),
          enabled: true,
        },
      ],
    });

    // CloudFront Function to rewrite subdomain to S3 prefix
    // e.g., feature-notes-to-issues.apex.wrangleit.net/path
    //    -> s3://bucket/feature-notes-to-issues/path
    // Also handles SPA routing by serving index.html for non-file paths
    const rewriteFunction = new cloudfront.Function(this, 'SubdomainRewriteFunction', {
      functionName: 'unisync-preview-subdomain-rewrite',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;
  var baseDomain = '${props.baseDomain}';

  // Extract subdomain (branch name)
  var subdomain = host.replace('.' + baseDomain, '');

  // Don't modify if accessing base domain directly
  if (subdomain === baseDomain || subdomain === '') {
    return request;
  }

  var uri = request.uri;

  // Check if this is a file request (has extension) or SPA route
  var hasExtension = /\\.[a-zA-Z0-9]+$/.test(uri);

  if (uri === '/' || uri === '' || !hasExtension) {
    // SPA route - serve index.html
    request.uri = '/' + subdomain + '/index.html';
  } else {
    // File request - serve the file
    request.uri = '/' + subdomain + uri;
  }

  return request;
}
      `),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // Import wildcard certificate
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'WildcardCertificate',
      props.wildcardCertificateArn
    );

    // CloudFront distribution with wildcard domain
    this.distribution = new cloudfront.Distribution(this, 'PreviewDistribution', {
      comment: 'UniSync Preview Deployments',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // No cache for previews
        functionAssociations: [
          {
            function: rewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html', // Will be rewritten by function
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Cheaper for previews
      domainNames: [`*.${props.baseDomain}`],
      certificate,
    });

    // Wildcard DNS record
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.baseDomain.split('.').slice(-2).join('.'),
    });

    new route53.ARecord(this, 'WildcardAliasRecord', {
      zone: hostedZone,
      recordName: `*.${props.baseDomain}`,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
    });

    // Outputs
    new cdk.CfnOutput(this, 'PreviewBucketName', {
      value: this.bucket.bucketName,
      exportName: 'unisync-preview-bucket',
    });

    new cdk.CfnOutput(this, 'PreviewDistributionId', {
      value: this.distribution.distributionId,
      exportName: 'unisync-preview-distribution-id',
    });

    new cdk.CfnOutput(this, 'PreviewDomain', {
      value: `*.${props.baseDomain}`,
      description: 'Wildcard domain for preview deployments',
    });
  }
}
