#!/usr/bin/env node
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
const cdk = __importStar(require("aws-cdk-lib"));
const data_stack_1 = require("../lib/data-stack");
const api_stack_1 = require("../lib/api-stack");
const frontend_stack_1 = require("../lib/frontend-stack");
const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION || 'us-east-1' };
const data = new data_stack_1.DataStack(app, 'PongDataStack', { env });
const api = new api_stack_1.ApiStack(app, 'PongApiStack', {
    env,
    tables: data.tables,
    sqs: data.sqs
});
new frontend_stack_1.FrontendStack(app, 'PongFrontendStack', {
    env,
    httpApiEndpoint: api.httpApi.apiEndpoint,
    wsApiEndpoint: api.wsApi.apiEndpoint
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsaURBQW1DO0FBQ25DLGtEQUE4QztBQUM5QyxnREFBNEM7QUFDNUMsMERBQXNEO0FBRXRELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLE1BQU0sR0FBRyxHQUFHLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVyxFQUFFLENBQUM7QUFFaEgsTUFBTSxJQUFJLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEdBQUcsRUFBRSxlQUFlLEVBQUUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBRTFELE1BQU0sR0FBRyxHQUFHLElBQUksb0JBQVEsQ0FBQyxHQUFHLEVBQUUsY0FBYyxFQUFFO0lBQzVDLEdBQUc7SUFDSCxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07SUFDbkIsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHO0NBQ2QsQ0FBQyxDQUFDO0FBRUgsSUFBSSw4QkFBYSxDQUFDLEdBQUcsRUFBRSxtQkFBbUIsRUFBRTtJQUMxQyxHQUFHO0lBQ0gsZUFBZSxFQUFFLEdBQUcsQ0FBQyxPQUFPLENBQUMsV0FBVztJQUN4QyxhQUFhLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxXQUFXO0NBQ3JDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBEYXRhU3RhY2sgfSBmcm9tICcuLi9saWIvZGF0YS1zdGFjayc7XG5pbXBvcnQgeyBBcGlTdGFjayB9IGZyb20gJy4uL2xpYi9hcGktc3RhY2snO1xuaW1wb3J0IHsgRnJvbnRlbmRTdGFjayB9IGZyb20gJy4uL2xpYi9mcm9udGVuZC1zdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbmNvbnN0IGVudiA9IHsgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCwgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gfHwgJ3VzLWVhc3QtMScgfTtcblxuY29uc3QgZGF0YSA9IG5ldyBEYXRhU3RhY2soYXBwLCAnUG9uZ0RhdGFTdGFjaycsIHsgZW52IH0pO1xuXG5jb25zdCBhcGkgPSBuZXcgQXBpU3RhY2soYXBwLCAnUG9uZ0FwaVN0YWNrJywge1xuICBlbnYsXG4gIHRhYmxlczogZGF0YS50YWJsZXMsXG4gIHNxczogZGF0YS5zcXNcbn0pO1xuXG5uZXcgRnJvbnRlbmRTdGFjayhhcHAsICdQb25nRnJvbnRlbmRTdGFjaycsIHtcbiAgZW52LFxuICBodHRwQXBpRW5kcG9pbnQ6IGFwaS5odHRwQXBpLmFwaUVuZHBvaW50LFxuICB3c0FwaUVuZHBvaW50OiBhcGkud3NBcGkuYXBpRW5kcG9pbnRcbn0pO1xuIl19