import os, json, boto3
d = boto3.resource('dynamodb')
players = d.Table(os.environ['PLAYERS_TABLE'])

def _resp(body, code=200):
    return {"statusCode": code, "headers": {"content-type":"application/json"}, "body": json.dumps(body)}

def handler(event, ctx):
    path = event.get("requestContext",{}).get("http",{}).get("path","")
    qs = event.get("queryStringParameters") or {}
    if path.endswith("/leaderboard"):
        limit = int(qs.get("limit","20"))
        # query by GSI_score with partition key "LEADERBOARD", descending by score
        resp = players.query(
            IndexName="GSI_score",
            KeyConditionExpression="leaderboard = :lb",
            ExpressionAttributeValues={":lb":"LEADERBOARD"},
            ScanIndexForward=False,
            Limit=limit
        )
        items = [{"userId":it["userId"],"username":it.get("username"),"tier":it.get("tier"),"score":int(it.get("score",0))} for it in resp.get("Items",[])]
        return _resp({"items": items})
    if path.endswith("/rank"):
        user_id = qs.get("userId")
        if not user_id: return _resp({"error":"userId required"},400)
        me = players.get_item(Key={"userId": user_id}).get("Item")
        if not me: return _resp({"error":"not found"},404)
        my_score = int(me.get("score",0))
        # naive rank: scan all and count (fine for class sizes)
        scan = players.scan(ProjectionExpression="userId,score,username,tier")
        higher = sum(1 for it in scan.get("Items",[]) if int(it.get("score",0)) > my_score)
        rank = higher + 1
        return _resp({"userId": user_id, "rank": rank, "score": my_score})
    return _resp({"error":"unknown"},400)
