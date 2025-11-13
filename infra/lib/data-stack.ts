import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export class DataStack extends cdk.Stack {
  public readonly tables: {
    players: dynamodb.Table;
    matches: dynamodb.Table;
    connections: dynamodb.Table;
    queue: dynamodb.Table;
  };
  public readonly sqs: { results: sqs.Queue };

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const players = new dynamodb.Table(this, 'Players', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    players.addGlobalSecondaryIndex({
      indexName: 'GSI_score',
      partitionKey: { name: 'leaderboard', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'score', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['username', 'tier']
    });

    const matches = new dynamodb.Table(this, 'Matches', {
      partitionKey: { name: 'matchId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const connections = new dynamodb.Table(this, 'Connections', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const queue = new dynamodb.Table(this, 'MatchmakingQueue', {
      partitionKey: { name: 'tier', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scoreKey', type: dynamodb.AttributeType.STRING }, // e.g., "00020#userId"
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const results = new sqs.Queue(this, 'GameResults', {
      visibilityTimeout: cdk.Duration.seconds(30),
      retentionPeriod: cdk.Duration.days(4)
    });

    this.tables = { players, matches, connections, queue };
    this.sqs = { results };
  }
}
