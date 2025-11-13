#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION || 'us-east-1' };

const data = new DataStack(app, 'PongDataStack', { env });

const api = new ApiStack(app, 'PongApiStack', {
  env,
  tables: data.tables,
  sqs: data.sqs
});

new FrontendStack(app, 'PongFrontendStack', {
  env,
  httpApiEndpoint: api.httpApi.apiEndpoint,
  wsApiEndpoint: api.wsApi.apiEndpoint
});
