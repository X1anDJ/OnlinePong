
# Deployment & Local Testing Steps

## 1. Install dependencies and build
cd infra
npm i -D @types/node
npm run build

## 2. Bootstrap and deploy backend stacks
npx cdk bootstrap
npx cdk deploy PongDataStack
npx cdk deploy PongApiStack

# → These commands will output 2 URLs. Add them to config.js

sample:
window.ENV = {
  HTTP_API_BASE: "https://1ql4j1jbpa.execute-api.us-east-1.amazonaws.com",
  WS_URL:        "wss://nae7wbnlz2.execute-api.us-east-1.amazonaws.com/prod"
};

## 3. Build & deploy the frontend
npm run build
npx cdk deploy PongFrontendStack

## 4. Test the frontend locally
python3 -m http.server 5173

# Visit:
# http://localhost:5173
