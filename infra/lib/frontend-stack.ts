import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as path from 'path';

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: { httpApiEndpoint: string; wsApiEndpoint: string } & cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const dist = new cloudfront.Distribution(this, 'WebDist', {
      defaultBehavior: { origin: new origins.S3Origin(bucket) },
      defaultRootObject: 'index.html'
    });

    // Example: write an .env.json for your SPA with endpoints
    new s3deploy.BucketDeployment(this, 'DeployWeb', {
      destinationBucket: bucket,
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../web'))],
      cacheControl: [s3deploy.CacheControl.noCache()]
    });

    new cdk.CfnOutput(this, 'FrontendUrl', { value: `https://${dist.domainName}` });
  }
}
