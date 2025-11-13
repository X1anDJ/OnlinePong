import os, json, time, boto3

d = boto3.resource('dynamodb')
connections = d.Table(os.environ['CONNECTIONS_TABLE'])
matches = d.Table(os.environ['MATCHES_TABLE'])
sqs = boto3.client('sqs')
RESULTS_QUEUE_URL = os.environ.get('RESULTS_QUEUE_URL')
WS_ENDPOINT = os.environ['WS_API_ENDPOINT']
mgmt = boto3.client('apigatewaymanagementapi', endpoint_url=WS_ENDPOINT)

def _post(cid, payload):
    mgmt.post_to_connection(ConnectionId=cid, Data=json.dumps(payload).encode('utf-8'))

def _find_other(match, my_id):
    ps = match.get("players", [])
    if len(ps) == 2:
      return ps[1] if ps[0]==my_id else ps[0]
    return None

def handler(event, ctx):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event.get("body") or "{}")
    msg_type = body.get("type")

    # resolve sender userId if you attached it on first JOIN
    # For MVP, let client include userId & matchId in every message
    user_id = body.get("userId")
    match_id = body.get("matchId")

    if msg_type == "JOIN":
        # store lightweight mapping in Connections (optional)
        connections.put_item(Item={"connectionId": connection_id, "userId": user_id, "matchId": match_id, "ttl": int(time.time())+900})
        return {"statusCode": 200, "body": "joined"}

    if msg_type == "INPUT":
        # relay inputs to opponent (no DB writes)
        m = matches.get_item(Key={"matchId": match_id}).get("Item") or {}
        other_user = _find_other(m, user_id)
        # find opponent connection(s)
        # naive: scan Connections to find their cid
        resp = connections.scan(ProjectionExpression="connectionId,userId,matchId")
        for it in resp.get("Items", []):
            if it.get("userId")==other_user and it.get("matchId")==match_id:
                _post(it["connectionId"], {"type":"INPUT", "from": user_id, "axis": body.get("axis"), "value": body.get("value"), "ts": body.get("ts")})
        return {"statusCode": 200, "body": "relayed"}

    if msg_type == "SCORE":
        # first-come referee for a rally
        m = matches.get_item(Key={"matchId": match_id}).get("Item") or {}
        if not m: return {"statusCode": 400, "body":"no match"}
        a,b = m.get("players",[None,None])
        scoreA, scoreB = int(m.get("scoreA",0)), int(m.get("scoreB",0))
        if body.get("scorer") == "A": scoreA += 1
        else: scoreB += 1
        m["scoreA"], m["scoreB"], m["state"] = scoreA, scoreB, "PLAYING"
        m["updatedAt"] = int(time.time())
        matches.put_item(Item=m)
        # broadcast score update
        resp = connections.scan(ProjectionExpression="connectionId,userId,matchId")
        for it in resp.get("Items", []):
            if it.get("matchId")==match_id:
                _post(it["connectionId"], {"type":"SCORE_UPDATE","scoreA":scoreA,"scoreB":scoreB})

        # check game over (to 10)
        if scoreA>=10 or scoreB>=10:
            winner = "A" if scoreA>scoreB else "B"
            m["state"]="FINISHED"; matches.put_item(Item=m)
            for it in resp.get("Items", []):
                if it.get("matchId")==match_id:
                    _post(it["connectionId"], {"type":"GAME_OVER","winner":winner})
            # enqueue result
            if RESULTS_QUEUE_URL:
                sqs.send_message(QueueUrl=RESULTS_QUEUE_URL, MessageBody=json.dumps({
                    "matchId": match_id, "players": m["players"], "scoreA": scoreA, "scoreB": scoreB
                }))
        return {"statusCode": 200, "body":"ok"}

    if msg_type == "PLAY_AGAIN":
        # MVP: just echo status; your client can start matchmaking again
        resp = connections.scan(ProjectionExpression="connectionId,matchId")
        for it in resp.get("Items", []):
            if it.get("matchId")==match_id:
                _post(it["connectionId"], {"type":"REPLAY_STATUS","agree": body.get("agree", False)})
        return {"statusCode": 200, "body":"ok"}

    return {"statusCode": 200, "body":"noop"}
