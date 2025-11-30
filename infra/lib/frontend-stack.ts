import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as path from 'path';

export class FrontendStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: { httpApiEndpoint: string; wsApiEndpoint: string } & cdk.StackProps
  ) {
    super(scope, id, props);

    // ----------------------------
    // 1. Create private S3 bucket
    // ----------------------------
    const bucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // -----------------------------------------------------
    // 2. Create OAI (Origin Access Identity)
    //    CloudFront will use this identity to read S3 files
    // -----------------------------------------------------
    const oai = new cloudfront.OriginAccessIdentity(this, 'WebOAI');

    // Grant read permissions to CloudFront
    bucket.grantRead(oai);

    // ----------------------------
    // 3. Create CloudFront distro
    // ----------------------------
    const distribution = new cloudfront.Distribution(this, 'WebDist', {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket, {
          originAccessIdentity: oai,
        }),
      },
      defaultRootObject: 'index.html',
    });

    // ----------------------------
    // 4. Deploy frontend to S3
    // ----------------------------
    new s3deploy.BucketDeployment(this, 'DeployWeb', {
      destinationBucket: bucket,
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../web'))],
      distribution, // 🔥– invalidate CF cache!
      distributionPaths: ['/*'],
      cacheControl: [s3deploy.CacheControl.noCache()],
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${distribution.domainName}`,
    });
  }
}
