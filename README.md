build:

cd infra
npm i -D @types/node
npm run build
npx cdk bootstrap
npx cdk deploy PongDataStack
npx cdk deploy PongApiStack

then it will return 2 url. Put it in 

npm run build
npx cdk deploy PongFrontendStack



test it locally:
python3 -m http.server 5173

