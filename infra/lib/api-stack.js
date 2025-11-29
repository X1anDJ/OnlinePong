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
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const path = __importStar(require("path"));
class ApiStack extends cdk.Stack {
    httpApi;
    wsApi;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { players, matches, connections, queue } = props.tables;
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
        players.grantReadWriteData(authFn);
        players.grantReadWriteData(lbFn);
        matches.grantReadWriteData(mmFn);
        queue.grantReadWriteData(mmFn);
        players.grantReadWriteData(mmFn);
        results.grantSendMessages(mmFn);
        results.grantConsumeMessages(rpFn);
        players.grantReadWriteData(rpFn);
        matches.grantReadWriteData(rpFn);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBpLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBRW5DLHNFQUF3RDtBQUN4RCx3RkFBMEU7QUFFMUUsK0RBQWlEO0FBQ2pELHlEQUEyQztBQUUzQywyQ0FBNkI7QUFFN0IsTUFBYSxRQUFTLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDckIsT0FBTyxDQUFrQjtJQUN6QixLQUFLLENBQXVCO0lBRTVDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FHeEI7UUFDaEIsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7UUFDOUQsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUM7UUFFOUIsTUFBTSxJQUFJLEdBQUcsQ0FBQyxJQUFZLEVBQUUsSUFBWSxFQUFFLE1BQThCLEVBQUUsRUFBRSxFQUFFLENBQzVFLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFO1lBQzlCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFDLEVBQUUsQ0FBQyxHQUFHLFVBQVU7WUFDNUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO1lBQ2xFLFdBQVcsRUFBRTtnQkFDWCxhQUFhLEVBQUUsT0FBTyxDQUFDLFNBQVM7Z0JBQ2hDLGFBQWEsRUFBRSxPQUFPLENBQUMsU0FBUztnQkFDaEMsaUJB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RUFBRSxXQUFXLEVBQUUsSUFBSSxZQUFZLENBQUMsMEJBQTBCLENBQUMsY0FBYyxFQUFFLFdBQVcsQ0FBQyxFQUFFO1lBQzlHLHNCQUFzQixFQUFFLEVBQUUsV0FBVyxFQUFFLElBQUksWUFBWSxDQUFDLDBCQUEwQixDQUFDLGlCQUFpQixFQUFFLGNBQWMsQ0FBQyxFQUFFO1lBQ3ZILG1CQUFtQixFQUFFLEVBQUUsV0FBVyxFQUFFLElBQUksWUFBWSxDQUFDLDBCQUEwQixDQUFDLGNBQWMsRUFBRSxXQUFXLENBQUMsRUFBRTtTQUMvRyxDQUFDLENBQUM7UUFFSCxNQUFNLE9BQU8sR0FBRyxJQUFJLE9BQU8sQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRTtZQUMxRCxZQUFZLEVBQUUsSUFBSSxDQUFDLEtBQUs7WUFDeEIsU0FBUyxFQUFFLE1BQU07WUFDakIsVUFBVSxFQUFFLElBQUk7U0FDakIsQ0FBQyxDQUFDO1FBRUgsV0FBVyxDQUFDLGNBQWMsQ0FBQyxpQkFBaUIsRUFBRSxXQUFXLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxnQkFBZ0IsSUFBSSxDQUFDLE1BQU0sa0JBQWtCLE9BQU8sQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBRTNJLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLEVBQUUsS0FBSyxFQUFFLFNBQVMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLGdCQUFnQixJQUFJLENBQUMsTUFBTSxrQkFBa0IsT0FBTyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUM1SSxDQUFDO0NBQ0Y7QUFqSEQsNEJBaUhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgYXBpZ3d2MiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyJztcbmltcG9ydCAqIGFzIGludGVncmF0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyLWludGVncmF0aW9ucyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgc3FzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGNsYXNzIEFwaVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGh0dHBBcGk6IGFwaWd3djIuSHR0cEFwaTtcbiAgcHVibGljIHJlYWRvbmx5IHdzQXBpOiBhcGlnd3YyLldlYlNvY2tldEFwaTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczoge1xuICAgIHRhYmxlczogeyBwbGF5ZXJzOiBkeW5hbW9kYi5UYWJsZTsgbWF0Y2hlczogZHluYW1vZGIuVGFibGU7IGNvbm5lY3Rpb25zOiBkeW5hbW9kYi5UYWJsZTsgcXVldWU6IGR5bmFtb2RiLlRhYmxlOyB9LFxuICAgIHNxczogeyByZXN1bHRzOiBzcXMuUXVldWUgfVxuICB9ICYgY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgcGxheWVycywgbWF0Y2hlcywgY29ubmVjdGlvbnMsIHF1ZXVlIH0gPSBwcm9wcy50YWJsZXM7XG4gICAgY29uc3QgeyByZXN1bHRzIH0gPSBwcm9wcy5zcXM7XG5cbiAgICBjb25zdCBta1B5ID0gKG5hbWU6IHN0cmluZywgZmlsZTogc3RyaW5nLCBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fSkgPT5cbiAgICAgIG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgbmFtZSwge1xuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMSxcbiAgICAgICAgaGFuZGxlcjogZmlsZS5yZXBsYWNlKCcucHknLCcnKSArICcuaGFuZGxlcicsXG4gICAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vbGFtYmRhcycpKSxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBQTEFZRVJTX1RBQkxFOiBwbGF5ZXJzLnRhYmxlTmFtZSxcbiAgICAgICAgICBNQVRDSEVTX1RBQkxFOiBtYXRjaGVzLnRhYmxlTmFtZSxcbiAgICAgICAgICBDT05ORUNUSU9OU19UQUJMRTogY29ubmVjdGlvbnMudGFibGVOYW1lLFxuICAgICAgICAgIFFVRVVFX1RBQkxFOiBxdWV1ZS50YWJsZU5hbWUsXG4gICAgICAgICAgUkVTVUxUU19RVUVVRV9VUkw6IHJlc3VsdHMucXVldWVVcmwsXG4gICAgICAgICAgLi4uZW52XG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogMjU2XG4gICAgICB9KTtcblxuICAgIC8vIEhUVFAgTGFtYmRhc1xuICAgIGNvbnN0IGF1dGhGbiA9IG1rUHkoJ0F1dGhGbicsICdhdXRoLnB5Jyk7XG4gICAgY29uc3QgbW1GbiAgID0gbWtQeSgnTWF0Y2htYWtpbmdGbicsICdtYXRjaG1ha2luZy5weScpO1xuICAgIGNvbnN0IGxiRm4gICA9IG1rUHkoJ0xlYWRlcmJvYXJkRm4nLCAnbGVhZGVyYm9hcmQucHknKTtcbiAgICBjb25zdCBycEZuICAgPSBta1B5KCdSZXN1bHRQcm9jZXNzb3JGbicsICdyZXN1bHRfcHJvY2Vzc29yLnB5Jyk7XG5cbiAgICBwbGF5ZXJzLmdyYW50UmVhZFdyaXRlRGF0YShhdXRoRm4pO1xuICAgIHBsYXllcnMuZ3JhbnRSZWFkV3JpdGVEYXRhKGxiRm4pO1xuICAgIG1hdGNoZXMuZ3JhbnRSZWFkV3JpdGVEYXRhKG1tRm4pO1xuICAgIHF1ZXVlLmdyYW50UmVhZFdyaXRlRGF0YShtbUZuKTtcbiAgICBwbGF5ZXJzLmdyYW50UmVhZFdyaXRlRGF0YShtbUZuKTtcbiAgICByZXN1bHRzLmdyYW50U2VuZE1lc3NhZ2VzKG1tRm4pO1xuICAgIHJlc3VsdHMuZ3JhbnRDb25zdW1lTWVzc2FnZXMocnBGbik7XG4gICAgcGxheWVycy5ncmFudFJlYWRXcml0ZURhdGEocnBGbik7XG4gICAgbWF0Y2hlcy5ncmFudFJlYWRXcml0ZURhdGEocnBGbik7XG5cbiAgICAvLyBXZWJTb2NrZXQgTGFtYmRhc1xuICAgIGNvbnN0IHdzQ29ubmVjdEZuID0gbWtQeSgnV3NDb25uZWN0Rm4nLCAnd3NfY29ubmVjdC5weScpO1xuICAgIGNvbnN0IHdzTWVzc2FnZUZuID0gbWtQeSgnV3NNZXNzYWdlRm4nLCAnd3NfbWVzc2FnZS5weScsIHt9KTtcbiAgICBjb25zdCB3c0Rpc2Nvbm5lY3RGbiA9IG1rUHkoJ1dzRGlzY29ubmVjdEZuJywgJ3dzX2Rpc2Nvbm5lY3QucHknKTtcblxuICAgIGNvbm5lY3Rpb25zLmdyYW50UmVhZFdyaXRlRGF0YSh3c0Nvbm5lY3RGbik7XG4gICAgY29ubmVjdGlvbnMuZ3JhbnRSZWFkV3JpdGVEYXRhKHdzTWVzc2FnZUZuKTtcbiAgICBjb25uZWN0aW9ucy5ncmFudFJlYWRXcml0ZURhdGEod3NEaXNjb25uZWN0Rm4pO1xuICAgIG1hdGNoZXMuZ3JhbnRSZWFkV3JpdGVEYXRhKHdzTWVzc2FnZUZuKTtcbiAgICByZXN1bHRzLmdyYW50U2VuZE1lc3NhZ2VzKHdzTWVzc2FnZUZuKTtcblxuICAgIC8vIFRoaXMgcG9saWN5IGxldHMgd3NfbWVzc2FnZSBjYWxsIEBjb25uZWN0aW9ucyBQT1NUIGZvciB0aGlzIEFQSVxuICAgIGNvbnN0IG1nbXRQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2V4ZWN1dGUtYXBpOk1hbmFnZUNvbm5lY3Rpb25zJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddIC8vIHNjb3BlIGRvd24gd2l0aCBleGFjdCBBUk4gaWYgeW91IHByZWZlclxuICAgIH0pO1xuICAgIHdzTWVzc2FnZUZuLmFkZFRvUm9sZVBvbGljeShtZ210UG9saWN5KTtcblxuICAgIC8vIEhUVFAgQVBJXG4gICAgdGhpcy5odHRwQXBpID0gbmV3IGFwaWd3djIuSHR0cEFwaSh0aGlzLCAnSHR0cEFwaScsIHtcbiAgICAgIGNvcnNQcmVmbGlnaHQ6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBbJyonXSwgLy8gdGlnaHRlbiB0byB5b3VyIENGIGRvbWFpbiBsYXRlclxuICAgICAgICBhbGxvd0hlYWRlcnM6IFsnY29udGVudC10eXBlJywnYXV0aG9yaXphdGlvbiddLFxuICAgICAgICBhbGxvd01ldGhvZHM6IFthcGlnd3YyLkNvcnNIdHRwTWV0aG9kLkdFVCwgYXBpZ3d2Mi5Db3JzSHR0cE1ldGhvZC5QT1NULCBhcGlnd3YyLkNvcnNIdHRwTWV0aG9kLk9QVElPTlNdXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB0aGlzLmh0dHBBcGkuYWRkUm91dGVzKHtcbiAgICAgIHBhdGg6ICcvYXV0aC97b3B9JyxcbiAgICAgIG1ldGhvZHM6IFthcGlnd3YyLkh0dHBNZXRob2QuUE9TVF0sXG4gICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5IdHRwTGFtYmRhSW50ZWdyYXRpb24oJ0F1dGhJbnQnLCBhdXRoRm4pXG4gICAgfSk7XG4gICAgdGhpcy5odHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiAnL21hdGNobWFraW5nL3tvcH0nLFxuICAgICAgbWV0aG9kczogW2FwaWd3djIuSHR0cE1ldGhvZC5QT1NUXSxcbiAgICAgIGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLkh0dHBMYW1iZGFJbnRlZ3JhdGlvbignTU1JbnQnLCBtbUZuKVxuICAgIH0pO1xuICAgIHRoaXMuaHR0cEFwaS5hZGRSb3V0ZXMoe1xuICAgICAgcGF0aDogJy9sZWFkZXJib2FyZCcsXG4gICAgICBtZXRob2RzOiBbYXBpZ3d2Mi5IdHRwTWV0aG9kLkdFVF0sXG4gICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5IdHRwTGFtYmRhSW50ZWdyYXRpb24oJ0xiSW50JywgbGJGbilcbiAgICB9KTtcbiAgICB0aGlzLmh0dHBBcGkuYWRkUm91dGVzKHtcbiAgICAgIHBhdGg6ICcvcmFuaycsXG4gICAgICBtZXRob2RzOiBbYXBpZ3d2Mi5IdHRwTWV0aG9kLkdFVF0sXG4gICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5IdHRwTGFtYmRhSW50ZWdyYXRpb24oJ1JhbmtJbnQnLCBsYkZuKVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0h0dHBBcGlVcmwnLCB7IHZhbHVlOiB0aGlzLmh0dHBBcGkuYXBpRW5kcG9pbnQgfSk7XG5cbiAgICAvLyBXZWJTb2NrZXQgQVBJXG4gICAgdGhpcy53c0FwaSA9IG5ldyBhcGlnd3YyLldlYlNvY2tldEFwaSh0aGlzLCAnV3NBcGknLCB7XG4gICAgICBjb25uZWN0Um91dGVPcHRpb25zOiB7IGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLldlYlNvY2tldExhbWJkYUludGVncmF0aW9uKCdXc0Nvbm5lY3RJbnQnLCB3c0Nvbm5lY3RGbikgfSxcbiAgICAgIGRpc2Nvbm5lY3RSb3V0ZU9wdGlvbnM6IHsgaW50ZWdyYXRpb246IG5ldyBpbnRlZ3JhdGlvbnMuV2ViU29ja2V0TGFtYmRhSW50ZWdyYXRpb24oJ1dzRGlzY29ubmVjdEludCcsIHdzRGlzY29ubmVjdEZuKSB9LFxuICAgICAgZGVmYXVsdFJvdXRlT3B0aW9uczogeyBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5XZWJTb2NrZXRMYW1iZGFJbnRlZ3JhdGlvbignV3NEZWZhdWx0SW50Jywgd3NNZXNzYWdlRm4pIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IHdzU3RhZ2UgPSBuZXcgYXBpZ3d2Mi5XZWJTb2NrZXRTdGFnZSh0aGlzLCAnV3NTdGFnZScsIHtcbiAgICAgIHdlYlNvY2tldEFwaTogdGhpcy53c0FwaSxcbiAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxuICAgICAgYXV0b0RlcGxveTogdHJ1ZVxuICAgIH0pO1xuXG4gICAgd3NNZXNzYWdlRm4uYWRkRW52aXJvbm1lbnQoJ1dTX0FQSV9FTkRQT0lOVCcsIGBodHRwczovLyR7dGhpcy53c0FwaS5hcGlJZH0uZXhlY3V0ZS1hcGkuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3dzU3RhZ2Uuc3RhZ2VOYW1lfWApO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1dzQXBpVXJsJywgeyB2YWx1ZTogYHdzczovLyR7dGhpcy53c0FwaS5hcGlJZH0uZXhlY3V0ZS1hcGkuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3dzU3RhZ2Uuc3RhZ2VOYW1lfWAgfSk7XG4gIH1cbn1cbiJdfQ==