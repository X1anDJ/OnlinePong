"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const apigwv2 = __importStar(require("aws-cdk-lib/aws-apigatewayv2"));
const integrations = __importStar(require("aws-cdk-lib/aws-apigatewayv2-integrations"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const aws_lambda_event_sources_1 = require("aws-cdk-lib/aws-lambda-event-sources");
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const path = __importStar(require("path"));
class ApiStack extends cdk.Stack {
    httpApi;
    wsApi;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { players, matches, connections, queue, matchHistory } = props.tables;
        const { results } = props.sqs;
        const mkPy = (name, file, env = {}) => new lambda.Function(this, name, {
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
        const matchHistoryWriter = mkPy("MatchHistoryWriterFn", "match_history_writer.py", {
            MATCH_HISTORY_TABLE: matchHistory.tableName,
        });
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
        rpFn.addEventSource(new aws_lambda_event_sources_1.SqsEventSource(results));
        results.grantConsumeMessages(matchHistoryWriter);
        matchHistoryWriter.addEventSource(new aws_lambda_event_sources_1.SqsEventSource(results));
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
            integration: new integrations.HttpLambdaIntegration("HistoryInt", historyFn),
        });
        new cdk.CfnOutput(this, "HttpApiUrl", { value: this.httpApi.apiEndpoint });
        // WebSocket API
        this.wsApi = new apigwv2.WebSocketApi(this, "WsApi", {
            connectRouteOptions: {
                integration: new integrations.WebSocketLambdaIntegration("WsConnectInt", wsConnectFn),
            },
            disconnectRouteOptions: {
                integration: new integrations.WebSocketLambdaIntegration("WsDisconnectInt", wsDisconnectFn),
            },
            defaultRouteOptions: {
                integration: new integrations.WebSocketLambdaIntegration("WsDefaultInt", wsMessageFn),
            },
        });
        const wsStage = new apigwv2.WebSocketStage(this, "WsStage", {
            webSocketApi: this.wsApi,
            stageName: "prod",
            autoDeploy: true,
        });
        wsMessageFn.addEnvironment("WS_API_ENDPOINT", `https://${this.wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`);
        new cdk.CfnOutput(this, "WsApiUrl", {
            value: `wss://${this.wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`,
        });
    }
}
exports.ApiStack = ApiStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBpLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBRW5DLHNFQUF3RDtBQUN4RCx3RkFBMEU7QUFFMUUsK0RBQWlEO0FBQ2pELG1GQUFzRTtBQUN0RSx5REFBMkM7QUFFM0MsMkNBQTZCO0FBRTdCLE1BQWEsUUFBUyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3JCLE9BQU8sQ0FBa0I7SUFDekIsS0FBSyxDQUF1QjtJQUU1QyxZQUNFLEtBQWdCLEVBQ2hCLEVBQVUsRUFDVixLQVNrQjtRQUVsQixLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7UUFDNUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUM7UUFFOUIsTUFBTSxJQUFJLEdBQUcsQ0FDWCxJQUFZLEVBQ1osSUFBWSxFQUNaLE1BQThCLEVBQUUsRUFDaEMsRUFBRSxDQUNGLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFO1lBQzlCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxHQUFHLFVBQVU7WUFDN0MsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO1lBQ2xFLFdBQVcsRUFBRTtnQkFDWCxhQUFhLEVBQUUsT0FBTyxDQUFDLFNBQVM7Z0JBQ2hDLGFBQWEsRUFBRSxP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QUMsMEJBQTBCLENBQ3RELGNBQWMsRUFDZCxXQUFXLENBQ1o7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxHQUFHLElBQUksT0FBTyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFO1lBQzFELFlBQVksRUFBRSxJQUFJLENBQUMsS0FBSztZQUN4QixTQUFTLEVBQUUsTUFBTTtZQUNqQixVQUFVLEVBQUUsSUFBSTtTQUNqQixDQUFDLENBQUM7UUFFSCxXQUFXLENBQUMsY0FBYyxDQUN4QixpQkFBaUIsRUFDakIsV0FBVyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssZ0JBQWdCLElBQUksQ0FBQyxNQUFNLGtCQUFrQixPQUFPLENBQUMsU0FBUyxFQUFFLENBQzVGLENBQUM7UUFFRixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUNsQyxLQUFLLEVBQUUsU0FBUyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssZ0JBQWdCLElBQUksQ0FBQyxNQUFNLGtCQUFrQixPQUFPLENBQUMsU0FBUyxFQUFFO1NBQ2pHLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWpMRCw0QkFpTEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0ICogYXMgYXBpZ3d2MiBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXl2MlwiO1xuaW1wb3J0ICogYXMgaW50ZWdyYXRpb25zIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyLWludGVncmF0aW9uc1wiO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XG5pbXBvcnQgeyBTcXNFdmVudFNvdXJjZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXNcIjtcbmltcG9ydCAqIGFzIGlhbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0ICogYXMgc3FzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gXCJwYXRoXCI7XG5cbmV4cG9ydCBjbGFzcyBBcGlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBodHRwQXBpOiBhcGlnd3YyLkh0dHBBcGk7XG4gIHB1YmxpYyByZWFkb25seSB3c0FwaTogYXBpZ3d2Mi5XZWJTb2NrZXRBcGk7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgc2NvcGU6IENvbnN0cnVjdCxcbiAgICBpZDogc3RyaW5nLFxuICAgIHByb3BzOiB7XG4gICAgICB0YWJsZXM6IHtcbiAgICAgICAgcGxheWVyczogZHluYW1vZGIuVGFibGU7XG4gICAgICAgIG1hdGNoZXM6IGR5bmFtb2RiLlRhYmxlO1xuICAgICAgICBjb25uZWN0aW9uczogZHluYW1vZGIuVGFibGU7XG4gICAgICAgIHF1ZXVlOiBkeW5hbW9kYi5UYWJsZTtcbiAgICAgICAgbWF0Y2hIaXN0b3J5OiBkeW5hbW9kYi5UYWJsZTtcbiAgICAgIH07XG4gICAgICBzcXM6IHsgcmVzdWx0czogc3FzLlF1ZXVlIH07XG4gICAgfSAmIGNkay5TdGFja1Byb3BzXG4gICkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBwbGF5ZXJzLCBtYXRjaGVzLCBjb25uZWN0aW9ucywgcXVldWUsIG1hdGNoSGlzdG9yeSB9ID0gcHJvcHMudGFibGVzO1xuICAgIGNvbnN0IHsgcmVzdWx0cyB9ID0gcHJvcHMuc3FzO1xuXG4gICAgY29uc3QgbWtQeSA9IChcbiAgICAgIG5hbWU6IHN0cmluZyxcbiAgICAgIGZpbGU6IHN0cmluZyxcbiAgICAgIGVudjogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gICAgKSA9PlxuICAgICAgbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBuYW1lLCB7XG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgICBoYW5kbGVyOiBmaWxlLnJlcGxhY2UoXCIucHlcIiwgXCJcIikgKyBcIi5oYW5kbGVyXCIsXG4gICAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uLy4uL2xhbWJkYXNcIikpLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIFBMQVlFUlNfVEFCTEU6IHBsYXllcnMudGFibGVOYW1lLFxuICAgICAgICAgIE1BVENIRVNfVEFCTEU6IG1hdGNoZXMudGFibGVOYW1lLFxuICAgICAgICAgIENPTk5FQ1RJT05TX1RBQkxFOiBjb25uZWN0aW9ucy50YWJsZU5hbWUsXG4gICAgICAgICAgUVVFVUVfVEFCTEU6IHF1ZXVlLnRhYmxlTmFtZSxcbiAgICAgICAgICBSRVNVTFRTX1FVRVVFX1VSTDogcmVzdWx0cy5xdWV1ZVVybCxcbiAgICAgICAgICAuLi5lbnYsXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgfSk7XG5cbiAgICAvLyBIVFRQIExhbWJkYXNcbiAgICBjb25zdCBhdXRoRm4gPSBta1B5KFwiQXV0aEZuXCIsIFwiYXV0aC5weVwiKTtcbiAgICBjb25zdCBtbUZuID0gbWtQeShcIk1hdGNobWFraW5nRm5cIiwgXCJtYXRjaG1ha2luZy5weVwiKTtcbiAgICBjb25zdCBsYkZuID0gbWtQeShcIkxlYWRlcmJvYXJkRm5cIiwgXCJsZWFkZXJib2FyZC5weVwiKTtcbiAgICBjb25zdCBycEZuID0gbWtQeShcIlJlc3VsdFByb2Nlc3NvckZuXCIsIFwicmVzdWx0X3Byb2Nlc3Nvci5weVwiKTtcbiAgICBjb25zdCBtYXRjaEhpc3RvcnlXcml0ZXIgPSBta1B5KFxuICAgICAgXCJNYXRjaEhpc3RvcnlXcml0ZXJGblwiLFxuICAgICAgXCJtYXRjaF9oaXN0b3J5X3dyaXRlci5weVwiLFxuICAgICAge1xuICAgICAgICBNQVRDSF9ISVNUT1JZX1RBQkxFOiBtYXRjaEhpc3RvcnkudGFibGVOYW1lLFxuICAgICAgfVxuICAgICk7XG4gICAgY29uc3QgaGlzdG9yeUZuID0gbWtQeShcIkhpc3RvcnlGblwiLCBcImhpc3RvcnkucHlcIiwge1xuICAgICAgTUFUQ0hfSElTVE9SWV9UQUJMRTogbWF0Y2hIaXN0b3J5LnRhYmxlTmFtZSxcbiAgICB9KTtcblxuICAgIHBsYXllcnMuZ3JhbnRSZWFkV3JpdGVEYXRhKGF1dGhGbik7XG4gICAgcGxheWVycy5ncmFudFJlYWRXcml0ZURhdGEobGJGbik7XG4gICAgbWF0Y2hlcy5ncmFudFJlYWRXcml0ZURhdGEobW1Gbik7XG4gICAgcXVldWUuZ3JhbnRSZWFkV3JpdGVEYXRhKG1tRm4pO1xuICAgIHBsYXllcnMuZ3JhbnRSZWFkV3JpdGVEYXRhKG1tRm4pO1xuICAgIHJlc3VsdHMuZ3JhbnRTZW5kTWVzc2FnZXMobW1Gbik7XG4gICAgcmVzdWx0cy5ncmFudENvbnN1bWVNZXNzYWdlcyhycEZuKTtcbiAgICBwbGF5ZXJzLmdyYW50UmVhZFdyaXRlRGF0YShycEZuKTtcbiAgICBtYXRjaGVzLmdyYW50UmVhZFdyaXRlRGF0YShycEZuKTtcblxuICAgIC8vIOKchSBXaXJlIHJlc3VsdCBwcm9jZXNzb3IgdG8gdGhlIHF1ZXVlXG4gICAgcnBGbi5hZGRFdmVudFNvdXJjZShuZXcgU3FzRXZlbnRTb3VyY2UocmVzdWx0cykpO1xuXG4gICAgcmVzdWx0cy5ncmFudENvbnN1bWVNZXNzYWdlcyhtYXRjaEhpc3RvcnlXcml0ZXIpO1xuICAgIG1hdGNoSGlzdG9yeVdyaXRlci5hZGRFdmVudFNvdXJjZShuZXcgU3FzRXZlbnRTb3VyY2UocmVzdWx0cykpO1xuICAgIG1hdGNoSGlzdG9yeS5ncmFudFJlYWRXcml0ZURhdGEobWF0Y2hIaXN0b3J5V3JpdGVyKTtcbiAgICBtYXRjaEhpc3RvcnkuZ3JhbnRSZWFkV3JpdGVEYXRhKGhpc3RvcnlGbik7XG5cbiAgICAvLyBXZWJTb2NrZXQgTGFtYmRhc1xuICAgIGNvbnN0IHdzQ29ubmVjdEZuID0gbWtQeShcIldzQ29ubmVjdEZuXCIsIFwid3NfY29ubmVjdC5weVwiKTtcbiAgICBjb25zdCB3c01lc3NhZ2VGbiA9IG1rUHkoXCJXc01lc3NhZ2VGblwiLCBcIndzX21lc3NhZ2UucHlcIiwge30pO1xuICAgIGNvbnN0IHdzRGlzY29ubmVjdEZuID0gbWtQeShcIldzRGlzY29ubmVjdEZuXCIsIFwid3NfZGlzY29ubmVjdC5weVwiKTtcblxuICAgIGNvbm5lY3Rpb25zLmdyYW50UmVhZFdyaXRlRGF0YSh3c0Nvbm5lY3RGbik7XG4gICAgY29ubmVjdGlvbnMuZ3JhbnRSZWFkV3JpdGVEYXRhKHdzTWVzc2FnZUZuKTtcbiAgICBjb25uZWN0aW9ucy5ncmFudFJlYWRXcml0ZURhdGEod3NEaXNjb25uZWN0Rm4pO1xuICAgIG1hdGNoZXMuZ3JhbnRSZWFkV3JpdGVEYXRhKHdzTWVzc2FnZUZuKTtcbiAgICByZXN1bHRzLmdyYW50U2VuZE1lc3NhZ2VzKHdzTWVzc2FnZUZuKTtcblxuICAgIC8vIFRoaXMgcG9saWN5IGxldHMgd3NfbWVzc2FnZSBjYWxsIEBjb25uZWN0aW9ucyBQT1NUIGZvciB0aGlzIEFQSVxuICAgIGNvbnN0IG1nbXRQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXCJleGVjdXRlLWFwaTpNYW5hZ2VDb25uZWN0aW9uc1wiXSxcbiAgICAgIHJlc291cmNlczogW1wiKlwiXSwgLy8gc2NvcGUgZG93biB3aXRoIGV4YWN0IEFSTiBpZiB5b3UgcHJlZmVyXG4gICAgfSk7XG4gICAgd3NNZXNzYWdlRm4uYWRkVG9Sb2xlUG9saWN5KG1nbXRQb2xpY3kpO1xuXG4gICAgLy8gSFRUUCBBUElcbiAgICB0aGlzLmh0dHBBcGkgPSBuZXcgYXBpZ3d2Mi5IdHRwQXBpKHRoaXMsIFwiSHR0cEFwaVwiLCB7XG4gICAgICBjb3JzUHJlZmxpZ2h0OiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogW1wiKlwiXSwgLy8gdGlnaHRlbiB0byB5b3VyIENGIGRvbWFpbiBsYXRlclxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcImNvbnRlbnQtdHlwZVwiLCBcImF1dGhvcml6YXRpb25cIl0sXG4gICAgICAgIGFsbG93TWV0aG9kczogW1xuICAgICAgICAgIGFwaWd3djIuQ29yc0h0dHBNZXRob2QuR0VULFxuICAgICAgICAgIGFwaWd3djIuQ29yc0h0dHBNZXRob2QuUE9TVCxcbiAgICAgICAgICBhcGlnd3YyLkNvcnNIdHRwTWV0aG9kLk9QVElPTlMsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5odHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiBcIi9hdXRoL3tvcH1cIixcbiAgICAgIG1ldGhvZHM6IFthcGlnd3YyLkh0dHBNZXRob2QuUE9TVF0sXG4gICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5IdHRwTGFtYmRhSW50ZWdyYXRpb24oXCJBdXRoSW50XCIsIGF1dGhGbiksXG4gICAgfSk7XG4gICAgdGhpcy5odHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiBcIi9tYXRjaG1ha2luZy97b3B9XCIsXG4gICAgICBtZXRob2RzOiBbYXBpZ3d2Mi5IdHRwTWV0aG9kLlBPU1RdLFxuICAgICAgaW50ZWdyYXRpb246IG5ldyBpbnRlZ3JhdGlvbnMuSHR0cExhbWJkYUludGVncmF0aW9uKFwiTU1JbnRcIiwgbW1GbiksXG4gICAgfSk7XG4gICAgdGhpcy5odHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiBcIi9sZWFkZXJib2FyZFwiLFxuICAgICAgbWV0aG9kczogW2FwaWd3djIuSHR0cE1ldGhvZC5HRVRdLFxuICAgICAgaW50ZWdyYXRpb246IG5ldyBpbnRlZ3JhdGlvbnMuSHR0cExhbWJkYUludGVncmF0aW9uKFwiTGJJbnRcIiwgbGJGbiksXG4gICAgfSk7XG4gICAgdGhpcy5odHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiBcIi9yYW5rXCIsXG4gICAgICBtZXRob2RzOiBbYXBpZ3d2Mi5IdHRwTWV0aG9kLkdFVF0sXG4gICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5IdHRwTGFtYmRhSW50ZWdyYXRpb24oXCJSYW5rSW50XCIsIGxiRm4pLFxuICAgIH0pO1xuICAgIHRoaXMuaHR0cEFwaS5hZGRSb3V0ZXMoe1xuICAgICAgcGF0aDogXCIvaGlzdG9yeVwiLFxuICAgICAgbWV0aG9kczogW2FwaWd3djIuSHR0cE1ldGhvZC5HRVRdLFxuICAgICAgaW50ZWdyYXRpb246IG5ldyBpbnRlZ3JhdGlvbnMuSHR0cExhbWJkYUludGVncmF0aW9uKFxuICAgICAgICBcIkhpc3RvcnlJbnRcIixcbiAgICAgICAgaGlzdG9yeUZuXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJIdHRwQXBpVXJsXCIsIHsgdmFsdWU6IHRoaXMuaHR0cEFwaS5hcGlFbmRwb2ludCB9KTtcblxuICAgIC8vIFdlYlNvY2tldCBBUElcbiAgICB0aGlzLndzQXBpID0gbmV3IGFwaWd3djIuV2ViU29ja2V0QXBpKHRoaXMsIFwiV3NBcGlcIiwge1xuICAgICAgY29ubmVjdFJvdXRlT3B0aW9uczoge1xuICAgICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5XZWJTb2NrZXRMYW1iZGFJbnRlZ3JhdGlvbihcbiAgICAgICAgICBcIldzQ29ubmVjdEludFwiLFxuICAgICAgICAgIHdzQ29ubmVjdEZuXG4gICAgICAgICksXG4gICAgICB9LFxuICAgICAgZGlzY29ubmVjdFJvdXRlT3B0aW9uczoge1xuICAgICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5XZWJTb2NrZXRMYW1iZGFJbnRlZ3JhdGlvbihcbiAgICAgICAgICBcIldzRGlzY29ubmVjdEludFwiLFxuICAgICAgICAgIHdzRGlzY29ubmVjdEZuXG4gICAgICAgICksXG4gICAgICB9LFxuICAgICAgZGVmYXVsdFJvdXRlT3B0aW9uczoge1xuICAgICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5XZWJTb2NrZXRMYW1iZGFJbnRlZ3JhdGlvbihcbiAgICAgICAgICBcIldzRGVmYXVsdEludFwiLFxuICAgICAgICAgIHdzTWVzc2FnZUZuXG4gICAgICAgICksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3Qgd3NTdGFnZSA9IG5ldyBhcGlnd3YyLldlYlNvY2tldFN0YWdlKHRoaXMsIFwiV3NTdGFnZVwiLCB7XG4gICAgICB3ZWJTb2NrZXRBcGk6IHRoaXMud3NBcGksXG4gICAgICBzdGFnZU5hbWU6IFwicHJvZFwiLFxuICAgICAgYXV0b0RlcGxveTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIHdzTWVzc2FnZUZuLmFkZEVudmlyb25tZW50KFxuICAgICAgXCJXU19BUElfRU5EUE9JTlRcIixcbiAgICAgIGBodHRwczovLyR7dGhpcy53c0FwaS5hcGlJZH0uZXhlY3V0ZS1hcGkuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3dzU3RhZ2Uuc3RhZ2VOYW1lfWBcbiAgICApO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJXc0FwaVVybFwiLCB7XG4gICAgICB2YWx1ZTogYHdzczovLyR7dGhpcy53c0FwaS5hcGlJZH0uZXhlY3V0ZS1hcGkuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3dzU3RhZ2Uuc3RhZ2VOYW1lfWAsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==