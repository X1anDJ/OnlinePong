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
            handler: file.replace('.py', '') + '.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas')),
            environment: {
                PLAYERS_TABLE: players.tableName,
                MATCHES_TABLE: matches.tableName,
                CONNECTIONS_TABLE: connections.tableName,
                QUEUE_TABLE: queue.tableName,
                RESULTS_QUEUE_URL: results.queueUrl,
                ...env
            },
            timeout: cdk.Duration.seconds(10),
            memorySize: 256
        });
        // HTTP Lambdas
        const authFn = mkPy('AuthFn', 'auth.py');
        const mmFn = mkPy('MatchmakingFn', 'matchmaking.py');
        const lbFn = mkPy('LeaderboardFn', 'leaderboard.py');
        const rpFn = mkPy('ResultProcessorFn', 'result_processor.py');
        const matchHistoryWriter = mkPy("MatchHistoryWriterFn", "match_history_writer.py", {
            MATCH_HISTORY_TABLE: matchHistory.tableName,
        });
        const historyFn = mkPy('HistoryFn', 'history.py', {
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
        results.grantConsumeMessages(matchHistoryWriter);
        matchHistoryWriter.addEventSource(new aws_lambda_event_sources_1.SqsEventSource(results));
        matchHistory.grantReadWriteData(matchHistoryWriter);
        matchHistory.grantReadWriteData(historyFn);
        // WebSocket Lambdas
        const wsConnectFn = mkPy('WsConnectFn', 'ws_connect.py');
        const wsMessageFn = mkPy('WsMessageFn', 'ws_message.py', {});
        const wsDisconnectFn = mkPy('WsDisconnectFn', 'ws_disconnect.py');
        connections.grantReadWriteData(wsConnectFn);
        connections.grantReadWriteData(wsMessageFn);
        connections.grantReadWriteData(wsDisconnectFn);
        matches.grantReadWriteData(wsMessageFn);
        results.grantSendMessages(wsMessageFn);
        // This policy lets ws_message call @connections POST for this API
        const mgmtPolicy = new iam.PolicyStatement({
            actions: ['execute-api:ManageConnections'],
            resources: ['*'] // scope down with exact ARN if you prefer
        });
        wsMessageFn.addToRolePolicy(mgmtPolicy);
        // HTTP API
        this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
            corsPreflight: {
                allowOrigins: ['*'], // tighten to your CF domain later
                allowHeaders: ['content-type', 'authorization'],
                allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS]
            }
        });
        this.httpApi.addRoutes({
            path: '/auth/{op}',
            methods: [apigwv2.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('AuthInt', authFn)
        });
        this.httpApi.addRoutes({
            path: '/matchmaking/{op}',
            methods: [apigwv2.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('MMInt', mmFn)
        });
        this.httpApi.addRoutes({
            path: '/leaderboard',
            methods: [apigwv2.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('LbInt', lbFn)
        });
        this.httpApi.addRoutes({
            path: '/rank',
            methods: [apigwv2.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('RankInt', lbFn)
        });
        this.httpApi.addRoutes({
            path: '/history',
            methods: [apigwv2.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('HistoryInt', historyFn)
        });
        new cdk.CfnOutput(this, 'HttpApiUrl', { value: this.httpApi.apiEndpoint });
        // WebSocket API
        this.wsApi = new apigwv2.WebSocketApi(this, 'WsApi', {
            connectRouteOptions: { integration: new integrations.WebSocketLambdaIntegration('WsConnectInt', wsConnectFn) },
            disconnectRouteOptions: { integration: new integrations.WebSocketLambdaIntegration('WsDisconnectInt', wsDisconnectFn) },
            defaultRouteOptions: { integration: new integrations.WebSocketLambdaIntegration('WsDefaultInt', wsMessageFn) }
        });
        const wsStage = new apigwv2.WebSocketStage(this, 'WsStage', {
            webSocketApi: this.wsApi,
            stageName: 'prod',
            autoDeploy: true
        });
        wsMessageFn.addEnvironment('WS_API_ENDPOINT', `https://${this.wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`);
        new cdk.CfnOutput(this, 'WsApiUrl', { value: `wss://${this.wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}` });
    }
}
exports.ApiStack = ApiStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBpLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBRW5DLHNFQUF3RDtBQUN4RCx3RkFBMEU7QUFFMUUsK0RBQWlEO0FBQ2pELG1GQUFzRTtBQUN0RSx5REFBMkM7QUFFM0MsMkNBQTZCO0FBRTdCLE1BQWEsUUFBUyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3JCLE9BQU8sQ0FBa0I7SUFDekIsS0FBSyxDQUF1QjtJQUU1QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBR3hCO1FBQ2hCLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQztRQUM1RSxNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQztRQUU5QixNQUFNLElBQUksR0FBRyxDQUFDLElBQVksRUFBRSxJQUFZLEVBQUUsTUFBOEIsRUFBRSxFQUFFLEVBQUUsQ0FDNUUsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUU7WUFDOUIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUMsRUFBRSxDQUFDLEdBQUcsVUFBVTtZQUM1QyxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsZUFBZSxDQUFDLENBQUM7WUFDbEUsV0FBVyxFQUFFO2dCQUNYLGFBQWEsRUFBRSxPQUFPLENBQUMsU0FBUztnQkFDaEMsYUFBYSxFQUFFLE9B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Y0FBYyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDMUQsWUFBWSxFQUFFLElBQUksQ0FBQyxLQUFLO1lBQ3hCLFNBQVMsRUFBRSxNQUFNO1lBQ2pCLFVBQVUsRUFBRSxJQUFJO1NBQ2pCLENBQUMsQ0FBQztRQUVILFdBQVcsQ0FBQyxjQUFjLENBQUMsaUJBQWlCLEVBQUUsV0FBVyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssZ0JBQWdCLElBQUksQ0FBQyxNQUFNLGtCQUFrQixPQUFPLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUUzSSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRSxFQUFFLEtBQUssRUFBRSxTQUFTLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxnQkFBZ0IsSUFBSSxDQUFDLE1BQU0sa0JBQWtCLE9BQU8sQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDNUksQ0FBQztDQUNGO0FBaklELDRCQWlJQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGFwaWd3djIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXl2Mic7XG5pbXBvcnQgKiBhcyBpbnRlZ3JhdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXl2Mi1pbnRlZ3JhdGlvbnMnO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IFNxc0V2ZW50U291cmNlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBjbGFzcyBBcGlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBodHRwQXBpOiBhcGlnd3YyLkh0dHBBcGk7XG4gIHB1YmxpYyByZWFkb25seSB3c0FwaTogYXBpZ3d2Mi5XZWJTb2NrZXRBcGk7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IHtcbiAgICB0YWJsZXM6IHsgcGxheWVyczogZHluYW1vZGIuVGFibGU7IG1hdGNoZXM6IGR5bmFtb2RiLlRhYmxlOyBjb25uZWN0aW9uczogZHluYW1vZGIuVGFibGU7IHF1ZXVlOiBkeW5hbW9kYi5UYWJsZTsgbWF0Y2hIaXN0b3J5OiBkeW5hbW9kYi5UYWJsZTt9LFxuICAgIHNxczogeyByZXN1bHRzOiBzcXMuUXVldWUgfVxuICB9ICYgY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgcGxheWVycywgbWF0Y2hlcywgY29ubmVjdGlvbnMsIHF1ZXVlLCBtYXRjaEhpc3RvcnkgfSA9IHByb3BzLnRhYmxlcztcbiAgICBjb25zdCB7IHJlc3VsdHMgfSA9IHByb3BzLnNxcztcblxuICAgIGNvbnN0IG1rUHkgPSAobmFtZTogc3RyaW5nLCBmaWxlOiBzdHJpbmcsIGVudjogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9KSA9PlxuICAgICAgbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBuYW1lLCB7XG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgICBoYW5kbGVyOiBmaWxlLnJlcGxhY2UoJy5weScsJycpICsgJy5oYW5kbGVyJyxcbiAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9sYW1iZGFzJykpLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIFBMQVlFUlNfVEFCTEU6IHBsYXllcnMudGFibGVOYW1lLFxuICAgICAgICAgIE1BVENIRVNfVEFCTEU6IG1hdGNoZXMudGFibGVOYW1lLFxuICAgICAgICAgIENPTk5FQ1RJT05TX1RBQkxFOiBjb25uZWN0aW9ucy50YWJsZU5hbWUsXG4gICAgICAgICAgUVVFVUVfVEFCTEU6IHF1ZXVlLnRhYmxlTmFtZSxcbiAgICAgICAgICBSRVNVTFRTX1FVRVVFX1VSTDogcmVzdWx0cy5xdWV1ZVVybCxcbiAgICAgICAgICAuLi5lbnZcbiAgICAgICAgfSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxuICAgICAgICBtZW1vcnlTaXplOiAyNTZcbiAgICAgIH0pO1xuXG4gICAgLy8gSFRUUCBMYW1iZGFzXG4gICAgY29uc3QgYXV0aEZuID0gbWtQeSgnQXV0aEZuJywgJ2F1dGgucHknKTtcbiAgICBjb25zdCBtbUZuICAgPSBta1B5KCdNYXRjaG1ha2luZ0ZuJywgJ21hdGNobWFraW5nLnB5Jyk7XG4gICAgY29uc3QgbGJGbiAgID0gbWtQeSgnTGVhZGVyYm9hcmRGbicsICdsZWFkZXJib2FyZC5weScpO1xuICAgIGNvbnN0IHJwRm4gICA9IG1rUHkoJ1Jlc3VsdFByb2Nlc3NvckZuJywgJ3Jlc3VsdF9wcm9jZXNzb3IucHknKTtcbiAgICBjb25zdCBtYXRjaEhpc3RvcnlXcml0ZXIgPSBta1B5KFwiTWF0Y2hIaXN0b3J5V3JpdGVyRm5cIiwgXCJtYXRjaF9oaXN0b3J5X3dyaXRlci5weVwiLCB7XG4gICAgICBNQVRDSF9ISVNUT1JZX1RBQkxFOiBtYXRjaEhpc3RvcnkudGFibGVOYW1lLFxuICAgIH0pO1xuICAgIGNvbnN0IGhpc3RvcnlGbiA9IG1rUHkoJ0hpc3RvcnlGbicsICdoaXN0b3J5LnB5Jywge1xuICAgICAgTUFUQ0hfSElTVE9SWV9UQUJMRTogbWF0Y2hIaXN0b3J5LnRhYmxlTmFtZSxcbiAgICB9KTtcbiAgICBcbiAgICBwbGF5ZXJzLmdyYW50UmVhZFdyaXRlRGF0YShhdXRoRm4pO1xuICAgIHBsYXllcnMuZ3JhbnRSZWFkV3JpdGVEYXRhKGxiRm4pO1xuICAgIG1hdGNoZXMuZ3JhbnRSZWFkV3JpdGVEYXRhKG1tRm4pO1xuICAgIHF1ZXVlLmdyYW50UmVhZFdyaXRlRGF0YShtbUZuKTtcbiAgICBwbGF5ZXJzLmdyYW50UmVhZFdyaXRlRGF0YShtbUZuKTtcbiAgICByZXN1bHRzLmdyYW50U2VuZE1lc3NhZ2VzKG1tRm4pO1xuICAgIHJlc3VsdHMuZ3JhbnRDb25zdW1lTWVzc2FnZXMocnBGbik7XG4gICAgcGxheWVycy5ncmFudFJlYWRXcml0ZURhdGEocnBGbik7XG4gICAgbWF0Y2hlcy5ncmFudFJlYWRXcml0ZURhdGEocnBGbik7XG4gICAgcmVzdWx0cy5ncmFudENvbnN1bWVNZXNzYWdlcyhtYXRjaEhpc3RvcnlXcml0ZXIpO1xuICAgIG1hdGNoSGlzdG9yeVdyaXRlci5hZGRFdmVudFNvdXJjZShuZXcgU3FzRXZlbnRTb3VyY2UocmVzdWx0cykpO1xuICAgIG1hdGNoSGlzdG9yeS5ncmFudFJlYWRXcml0ZURhdGEobWF0Y2hIaXN0b3J5V3JpdGVyKTtcbiAgICBtYXRjaEhpc3RvcnkuZ3JhbnRSZWFkV3JpdGVEYXRhKGhpc3RvcnlGbik7XG5cblxuICAgIC8vIFdlYlNvY2tldCBMYW1iZGFzXG4gICAgY29uc3Qgd3NDb25uZWN0Rm4gPSBta1B5KCdXc0Nvbm5lY3RGbicsICd3c19jb25uZWN0LnB5Jyk7XG4gICAgY29uc3Qgd3NNZXNzYWdlRm4gPSBta1B5KCdXc01lc3NhZ2VGbicsICd3c19tZXNzYWdlLnB5Jywge30pO1xuICAgIGNvbnN0IHdzRGlzY29ubmVjdEZuID0gbWtQeSgnV3NEaXNjb25uZWN0Rm4nLCAnd3NfZGlzY29ubmVjdC5weScpO1xuXG4gICAgY29ubmVjdGlvbnMuZ3JhbnRSZWFkV3JpdGVEYXRhKHdzQ29ubmVjdEZuKTtcbiAgICBjb25uZWN0aW9ucy5ncmFudFJlYWRXcml0ZURhdGEod3NNZXNzYWdlRm4pO1xuICAgIGNvbm5lY3Rpb25zLmdyYW50UmVhZFdyaXRlRGF0YSh3c0Rpc2Nvbm5lY3RGbik7XG4gICAgbWF0Y2hlcy5ncmFudFJlYWRXcml0ZURhdGEod3NNZXNzYWdlRm4pO1xuICAgIHJlc3VsdHMuZ3JhbnRTZW5kTWVzc2FnZXMod3NNZXNzYWdlRm4pO1xuXG4gICAgLy8gVGhpcyBwb2xpY3kgbGV0cyB3c19tZXNzYWdlIGNhbGwgQGNvbm5lY3Rpb25zIFBPU1QgZm9yIHRoaXMgQVBJXG4gICAgY29uc3QgbWdtdFBvbGljeSA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnZXhlY3V0ZS1hcGk6TWFuYWdlQ29ubmVjdGlvbnMnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10gLy8gc2NvcGUgZG93biB3aXRoIGV4YWN0IEFSTiBpZiB5b3UgcHJlZmVyXG4gICAgfSk7XG4gICAgd3NNZXNzYWdlRm4uYWRkVG9Sb2xlUG9saWN5KG1nbXRQb2xpY3kpO1xuXG4gICAgLy8gSFRUUCBBUElcbiAgICB0aGlzLmh0dHBBcGkgPSBuZXcgYXBpZ3d2Mi5IdHRwQXBpKHRoaXMsICdIdHRwQXBpJywge1xuICAgICAgY29yc1ByZWZsaWdodDoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IFsnKiddLCAvLyB0aWdodGVuIHRvIHlvdXIgQ0YgZG9tYWluIGxhdGVyXG4gICAgICAgIGFsbG93SGVhZGVyczogWydjb250ZW50LXR5cGUnLCdhdXRob3JpemF0aW9uJ10sXG4gICAgICAgIGFsbG93TWV0aG9kczogW2FwaWd3djIuQ29yc0h0dHBNZXRob2QuR0VULCBhcGlnd3YyLkNvcnNIdHRwTWV0aG9kLlBPU1QsIGFwaWd3djIuQ29yc0h0dHBNZXRob2QuT1BUSU9OU11cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHRoaXMuaHR0cEFwaS5hZGRSb3V0ZXMoe1xuICAgICAgcGF0aDogJy9hdXRoL3tvcH0nLFxuICAgICAgbWV0aG9kczogW2FwaWd3djIuSHR0cE1ldGhvZC5QT1NUXSxcbiAgICAgIGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLkh0dHBMYW1iZGFJbnRlZ3JhdGlvbignQXV0aEludCcsIGF1dGhGbilcbiAgICB9KTtcbiAgICB0aGlzLmh0dHBBcGkuYWRkUm91dGVzKHtcbiAgICAgIHBhdGg6ICcvbWF0Y2htYWtpbmcve29wfScsXG4gICAgICBtZXRob2RzOiBbYXBpZ3d2Mi5IdHRwTWV0aG9kLlBPU1RdLFxuICAgICAgaW50ZWdyYXRpb246IG5ldyBpbnRlZ3JhdGlvbnMuSHR0cExhbWJkYUludGVncmF0aW9uKCdNTUludCcsIG1tRm4pXG4gICAgfSk7XG4gICAgdGhpcy5odHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiAnL2xlYWRlcmJvYXJkJyxcbiAgICAgIG1ldGhvZHM6IFthcGlnd3YyLkh0dHBNZXRob2QuR0VUXSxcbiAgICAgIGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLkh0dHBMYW1iZGFJbnRlZ3JhdGlvbignTGJJbnQnLCBsYkZuKVxuICAgIH0pO1xuICAgIHRoaXMuaHR0cEFwaS5hZGRSb3V0ZXMoe1xuICAgICAgcGF0aDogJy9yYW5rJyxcbiAgICAgIG1ldGhvZHM6IFthcGlnd3YyLkh0dHBNZXRob2QuR0VUXSxcbiAgICAgIGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLkh0dHBMYW1iZGFJbnRlZ3JhdGlvbignUmFua0ludCcsIGxiRm4pXG4gICAgfSk7XG4gICAgdGhpcy5odHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiAnL2hpc3RvcnknLFxuICAgICAgbWV0aG9kczogW2FwaWd3djIuSHR0cE1ldGhvZC5HRVRdLFxuICAgICAgaW50ZWdyYXRpb246IG5ldyBpbnRlZ3JhdGlvbnMuSHR0cExhbWJkYUludGVncmF0aW9uKCdIaXN0b3J5SW50JywgaGlzdG9yeUZuKVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0h0dHBBcGlVcmwnLCB7IHZhbHVlOiB0aGlzLmh0dHBBcGkuYXBpRW5kcG9pbnQgfSk7XG5cbiAgICAvLyBXZWJTb2NrZXQgQVBJXG4gICAgdGhpcy53c0FwaSA9IG5ldyBhcGlnd3YyLldlYlNvY2tldEFwaSh0aGlzLCAnV3NBcGknLCB7XG4gICAgICBjb25uZWN0Um91dGVPcHRpb25zOiB7IGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLldlYlNvY2tldExhbWJkYUludGVncmF0aW9uKCdXc0Nvbm5lY3RJbnQnLCB3c0Nvbm5lY3RGbikgfSxcbiAgICAgIGRpc2Nvbm5lY3RSb3V0ZU9wdGlvbnM6IHsgaW50ZWdyYXRpb246IG5ldyBpbnRlZ3JhdGlvbnMuV2ViU29ja2V0TGFtYmRhSW50ZWdyYXRpb24oJ1dzRGlzY29ubmVjdEludCcsIHdzRGlzY29ubmVjdEZuKSB9LFxuICAgICAgZGVmYXVsdFJvdXRlT3B0aW9uczogeyBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5XZWJTb2NrZXRMYW1iZGFJbnRlZ3JhdGlvbignV3NEZWZhdWx0SW50Jywgd3NNZXNzYWdlRm4pIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IHdzU3RhZ2UgPSBuZXcgYXBpZ3d2Mi5XZWJTb2NrZXRTdGFnZSh0aGlzLCAnV3NTdGFnZScsIHtcbiAgICAgIHdlYlNvY2tldEFwaTogdGhpcy53c0FwaSxcbiAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxuICAgICAgYXV0b0RlcGxveTogdHJ1ZVxuICAgIH0pO1xuXG4gICAgd3NNZXNzYWdlRm4uYWRkRW52aXJvbm1lbnQoJ1dTX0FQSV9FTkRQT0lOVCcsIGBodHRwczovLyR7dGhpcy53c0FwaS5hcGlJZH0uZXhlY3V0ZS1hcGkuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3dzU3RhZ2Uuc3RhZ2VOYW1lfWApO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1dzQXBpVXJsJywgeyB2YWx1ZTogYHdzczovLyR7dGhpcy53c0FwaS5hcGlJZH0uZXhlY3V0ZS1hcGkuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3dzU3RhZ2Uuc3RhZ2VOYW1lfWAgfSk7XG4gIH1cbn1cbiJdfQ==