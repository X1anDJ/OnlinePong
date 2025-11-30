# Deployment & Local Testing Steps

## 1. Install dependencies and build
```
cd infra
npm i -D @types/node
npm run build
```

## 2. Bootstrap and deploy backend stacks
```
npx cdk bootstrap
npx cdk deploy PongDataStack
npx cdk deploy PongApiStack
```
###  These commands will output 2 URLs. Add them to config.js

## sample config.js:
```
window.ENV = {
  HTTP_API_BASE: "https://nt0nuo8o0i.execute-api.us-east-1.amazonaws.com",
  WS_URL:        "wss://ebwv2ltaj2.execute-api.us-east-1.amazonaws.com/prod"
};
```
## 3. Build & deploy the frontend
```
npm run build
npx cdk deploy PongFrontendStack
```
It will output a url for the frontend client.
Then use two tabs to test the game clients on 
#### https://d315b95f47u6mm.cloudfront.net/

# Test the frontend locally
```
python3 -m http.server 5173
```
### Visit:
#### http://localhost:5173


## Data schema

- **Players** (`userId` PK)  
  Stores account or guest records. Attributes: `username`, optional `password`, `score`, `tier`, `leaderboard` (constant `"LEADERBOARD"` so that the GSI has a fixed partition key), `createdAt`, `updatedAt`. A global secondary index `GSI_score` (`leaderboard` PK, `score` SK, includes `username`, `tier`) drives the leaderboard query.
```bash
{
  "table": "Players",
  "partitionKey": "userId",
  "attributes": {
    "userId": "string",
    "username": "string",
    "password": "string (optional)",
    "score": "number",
    "tier": "string",
    "leaderboard": "string (constant 'LEADERBOARD')",
    "createdAt": "number",
    "updatedAt": "number"
  },
  "indexes": {
    "GSI_score": {
      "partitionKey": "leaderboard",
      "sortKey": "score",
      "project": ["username", "tier"],
    }
  }
}
```

- **Matches** (`matchId` PK, TTL `ttl`)  
  Tracks the lifecycle of a head‑to‑head game. Attributes: `players` (two user ids), running `scoreA`/`scoreB`, `state` (`CREATED`, `PLAYING`, `FINISHED`), `createdAt`, `updatedAt`, and optional `finalScoreA`/`finalScoreB`. Items live for 24 hours.
```bash
{
  "table": "Matches",
  "partitionKey": "matchId",
  "ttl": "ttl",
  "attributes": {
    "matchId": "string",
    "players": ["userIdA", "userIdB"],
    "scoreA": "number",
    "scoreB": "number",
    "state": "CREATED | PLAYING | FINISHED",
    "createdAt": "number",
    "updatedAt": "number",
    "finalScoreA": "number (optional)",
    "finalScoreB": "number (optional)"
  }
}
```

- **Connections** (`connectionId` PK, TTL `ttl`)  
  Keeps the mapping between an API Gateway WebSocket connection and the logical `userId`/`matchId`, so the ws_message Lambda can fan out INPUT/STATE/SCORE messages only to the participants that share the same match.
```bash
{
  "table": "Connections",
  "partitionKey": "connectionId",
  "ttl": "ttl",
  "attributes": {
    "connectionId": "string",
    "userId": "string",
    "matchId": "string",
    "createdAt": "number"
  }
}
```

- **MatchmakingQueue** (`tier` PK, `scoreKey` SK, TTL `ttl`)  
  Short-lived rows that represent players waiting to be paired. `scoreKey` is a zero-padded score plus user id (`00020#user-123`) that enables ordering inside the tier. Attributes: `userId`, `score`, `enqueuedAt`. Items expire after ~15 seconds so stale queue entries disappear automatically.
```bash
{
  "table": "MatchmakingQueue",
  "partitionKey": "tier",
  "sortKey": "scoreKey (e.g., '00020#userId')",
  "ttl": "ttl",
  "attributes": {
    "tier": "string",
    "scoreKey": "string",
    "userId": "string",
    "score": "number",
    "enqueuedAt": "number"
  }
}
```

- **MatchHistory** (`userId` PK, `timestamp` SK)  
  Append-only log written by `match_history_writer.py` whenever a result message arrives on the SQS queue. Each item stores `matchId`, `opponentId`, `scoreFor`, `scoreAgainst`, and the derived `result`, so clients can page through their past matches without scanning the `Matches` table.
```bash
{
  "table": "MatchHistory",
  "partitionKey": "userId",
  "sortKey": "timestamp",
  "attributes": {
    "userId": "string",
    "timestamp": "number",
    "matchId": "string",
    "opponentId": "string",
    "scoreFor": "number",
    "scoreAgainst": "number",
    "result": "WIN | LOSS"
  }
}
```

- **GameResults queue (SQS)**  
  ws_message enqueues `{ matchId, players, scoreA, scoreB }` when a rally reaches 10 points. Two consumers listen to the queue: `result_processor.py` bumps player scores/tiers and updates the `Matches` record, and `match_history_writer.py` fans each result out into two `MatchHistory` rows (one per player) so the frontend can render a history table.
```bash
{
  "queue": "GameResults",
  "messageExample": {
    "matchId": "string",
    "players": ["userA", "userB"],
    "scoreA": "number",
    "scoreB": "number"
  },
  "consumers": [
    "result_processor.py",
    "match_history_writer.py"
  ]
}
```

## API Design

### HTTP API (`${HTTP_API_BASE}`)

| Method & Path | Request body / query | Response (200) | Notes |
| --- | --- | --- | --- |
| `POST /auth/guest` | `{ "username": "optional display name" }` | `{ userId, username, token }` | Creates a throwaway account with score 0/tier beginner. |
| `POST /auth/signup` | `{ "username": "...", "password": "..." }` | `{ userId, token }` | Minimal signup, password stored as‑is (class project only). |
| `POST /auth/login` | `{ "username": "...", "password": "..." }` | `{ userId, token }` | Scans the Players table to locate the account. |
| `POST /matchmaking/start` | `{ "userId": "..." }` | On match: `{ matchId, opponent }`; queued: `{ queued: true, tier }` | Reads score → tier, inserts into `MatchmakingQueue`, returns immediately if a peer was waiting. |
| `POST /matchmaking/check` | `{ "userId": "..." }` | `{ matchId, opponent }` or `{ queued: true }` | Polling endpoint the UI calls every second while waiting. Looks for `Matches` items that include the caller and are still `CREATED/PLAYING`. |
| `POST /matchmaking/cancel` | `{ "userId": "...", "scoreKey": "optional known scoreKey" }` | `{ ok: true }` | Best effort removal from the queue. When `scoreKey` is omitted we delete a placeholder per tier so stale entries expire via TTL. |
| `GET /leaderboard?limit=20` | query: `limit` (default 20) | `{ items: [{ userId, username, tier, score }, ...] }` | Reads `GSI_score` descending, so higher scores appear first. |
| `GET /rank?userId=...` | query: `userId` | `{ userId, rank, score }` | Fetches the player and counts how many players have a greater score (naive scan). |
| `GET /history?userId=...` | query: `userId` (required) | `{ items: [{ matchId, opponentId, scoreFor, scoreAgainst, result, timestamp }, ...] }` | Queries the `MatchHistory` table for that user, sorted newest-first by the sort key; values are normalized to plain ints/strings for JSON. |

All HTTP responses use `application/json` and standard `4xx/5xx` codes for validation failures.

### WebSocket API (`${WS_URL}`)

Clients connect once per match and send small JSON envelopes. The `ws_message` Lambda fans out messages to any connection stored with the same `matchId`.

- `JOIN`
```bash
{
  "type": "JOIN",
  "userId": "...",
  "matchId": "..."
}
```
`{ "type":"JOIN", "userId":"...", "matchId":"..." }` registers the connection with TTL ~15 min, enabling lookups later.
- `INPUT`
```bash
{
  "type": "INPUT",
  "userId": "...",
  "matchId": "...",
  "axis": "y",
  "value": -1,
  "ts": 123
}
```
`{ "type":"INPUT", "userId":"...", "matchId":"...", "axis":"y", "value":-1|0|1, "ts":123 }`. Host relays paddle input to the opponent.
- `STATE`
```bash
{
  "type": "STATE",
  "ball": { "x": 0, "y": 0 },
  "paddleA": { "y": 0.5 },
  "paddleB": { "y": -0.1 },
  "scoreA": 3,
  "scoreB": 2
}
```
Host authoritative state `{ "type":"STATE", "ball":{x,y}, "paddleA":{y}, "paddleB":{y}, "scoreA":n, "scoreB":m }`. Server broadcasts to both sides.
- `SCORE`
```bash
{
  "type": "SCORE",
  "userId": "...",
  "matchId": "...",
  "scorer": "A" 
}
```
`{ "type":"SCORE", "userId":"...", "matchId":"...", "scorer":"A"|"B" }`. The Lambda increments the running score inside `Matches`, emits `SCORE_UPDATE`, and when either side reaches 10 points it emits `GAME_OVER` and enqueues the result to SQS.
- `PLAY_AGAIN`
```bash
{
  "type": "PLAY_AGAIN",
  "userId": "...",
  "matchId": "...",
  "agree": true
}
```
`{ "type":"PLAY_AGAIN", "userId":"...", "matchId":"...", "agree":true|false }`. Broadcast back as `REPLAY_STATUS` so the UI can coordinate rematches/re-queuing.

These messages are the only contract between the browser game loop and the backend; adding new game events simply means defining another `type` and handling it in `ws_message.py`.
