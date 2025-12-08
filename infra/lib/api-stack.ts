import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as path from "path";

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly wsApi: apigwv2.WebSocketApi;

  constructor(
    scope: Construct,
    id: string,
    props: {
      tables: {
        players: dynamodb.Table;
        matches: dynamodb.Table;
        connections: dynamodb.Table;
        queue: dynamodb.Table;
        matchHistory: dynamodb.Table;
      };
      sqs: { results: sqs.Queue };
    } & cdk.StackProps
  ) {
    super(scope, id, props);

    const { players, matches, connections, queue, matchHistory } = props.tables;
    const { results } = props.sqs;

    const mkPy = (
      name: string,
      file: string,
      env: Record<string, string> = {}
    ) =>
      new lambda.Function(this, name, {
        runtime: lambda.Runtime.PYTHON_3_11,
        handler: file.replace(".py", "") + ".handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../../lambdas")),
        environment: {
          PLAYERS_TABLE: players.tableName,
          MATCHES_TABLE: matches.tableName,
          CONNECTIONS_TABLE: connections.tableName,
          QUEUE_TABLE: queue.tableName,
          RESULTS_QUEUE_URL: results.queueUrl,
          ...env,
        },
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
      });

    // HTTP Lambdas
    const authFn = mkPy("AuthFn", "auth.py");
    const mmFn = mkPy("MatchmakingFn", "matchmaking.py");
    const lbFn = mkPy("LeaderboardFn", "leaderboard.py");
    const rpFn = mkPy("ResultProcessorFn", "result_processor.py");
    const matchHistoryWriter = mkPy(
      "MatchHistoryWriterFn",
      "match_history_writer.py",
      {
        MATCH_HISTORY_TABLE: matchHistory.tableName,
      }
    );
    const historyFn = mkPy("HistoryFn", "history.py", {
      MATCH_HISTORY_TABLE: matchHistory.tableName,
    });

    players.grantReadWriteData(authFn);
    players.grantReadWriteData(lbFn);
    matches.grantReadWriteData(mmFn);
    queue.grantReadWriteData(mmFn);
    players.grantReadWriteData(mmFn);
    results.grantSendMessages(mmFn);
    results.grantConsumeMessages(rpFn);
    players.grantReadWriteData(rpFn);
    matches.grantReadWriteData(rpFn);

    // ✅ Wire result processor to the queue
    rpFn.addEventSource(new SqsEventSource(results));

    results.grantConsumeMessages(matchHistoryWriter);
    matchHistoryWriter.addEventSource(new SqsEventSource(results));
    matchHistory.grantReadWriteData(matchHistoryWriter);
    matchHistory.grantReadWriteData(historyFn);

    // WebSocket Lambdas
    const wsConnectFn = mkPy("WsConnectFn", "ws_connect.py");
    const wsMessageFn = mkPy("WsMessageFn", "ws_message.py", {});
    const wsDisconnectFn = mkPy("WsDisconnectFn", "ws_disconnect.py");

    connections.grantReadWriteData(wsConnectFn);
    connections.grantReadWriteData(wsMessageFn);
    connections.grantReadWriteData(wsDisconnectFn);
    matches.grantReadWriteData(wsMessageFn);
    results.grantSendMessages(wsMessageFn);

    // This policy lets ws_message call @connections POST for this API
    const mgmtPolicy = new iam.PolicyStatement({
      actions: ["execute-api:ManageConnections"],
      resources: ["*"], // scope down with exact ARN if you prefer
    });
    wsMessageFn.addToRolePolicy(mgmtPolicy);

    // HTTP API
    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: ["*"], // tighten to your CF domain later
        allowHeaders: ["content-type", "authorization"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
      },
    });

    this.httpApi.addRoutes({
      path: "/auth/{op}",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("AuthInt", authFn),
    });
    this.httpApi.addRoutes({
      path: "/matchmaking/{op}",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("MMInt", mmFn),
    });
    this.httpApi.addRoutes({
      path: "/leaderboard",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("LbInt", lbFn),
    });
    this.httpApi.addRoutes({
      path: "/rank",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("RankInt", lbFn),
    });
    this.httpApi.addRoutes({
      path: "/history",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "HistoryInt",
        historyFn
      ),
    });

    new cdk.CfnOutput(this, "HttpApiUrl", { value: this.httpApi.apiEndpoint });

    // WebSocket API
    this.wsApi = new apigwv2.WebSocketApi(this, "WsApi", {
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          "WsConnectInt",
          wsConnectFn
        ),
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          "WsDisconnectInt",
          wsDisconnectFn
        ),
      },
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          "WsDefaultInt",
          wsMessageFn
        ),
      },
    });

    const wsStage = new apigwv2.WebSocketStage(this, "WsStage", {
      webSocketApi: this.wsApi,
      stageName: "prod",
      autoDeploy: true,
    });

    wsMessageFn.addEnvironment(
      "WS_API_ENDPOINT",
      `https://${this.wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`
    );

    new cdk.CfnOutput(this, "WsApiUrl", {
      value: `wss://${this.wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`,
    });
  }
}
