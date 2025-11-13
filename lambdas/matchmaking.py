import os, json, time, uuid, boto3
from decimal import Decimal
d = boto3.resource('dynamodb')
players = d.Table(os.environ['PLAYERS_TABLE'])
queue = d.Table(os.environ['QUEUE_TABLE'])
matches = d.Table(os.environ['MATCHES_TABLE'])
sqs = boto3.client('sqs')
RESULTS_QUEUE_URL = os.environ['RESULTS_QUEUE_URL']

def _tier(score:int):
    if score < 20: return "beginner"
    if score < 40: return "intermediate"
    return "master"

def _pad(n:int): return f"{n:05d}"

def _resp(body, code=200):
    return {"statusCode": code, "headers": {"content-type":"application/json"}, "body": json.dumps(body)}

def handler(event, ctx):
    op = event.get("pathParameters", {}).get("op")
    body = json.loads(event.get("body") or "{}")
    user_id = body["userId"]

    if op == "start":
        # read score
        p = players.get_item(Key={"userId": user_id}).get("Item")
        score = int(p.get("score", 0))
        tier = _tier(score)
        now = int(time.time())
        # write self into queue with TTL 15s
        sk = f"{_pad(score)}#{user_id}"
        queue.put_item(Item={"tier": tier, "scoreKey": sk, "userId": user_id, "score": score, "enqueuedAt": now, "ttl": now + 15})
        # try to find closest in same tier (simple scan/query)
        # small scale: scan + pick closest
        q = queue.query(KeyConditionExpression="tier = :t", ExpressionAttributeValues={":t": tier})
        candidates = [it for it in q.get("Items", []) if it["userId"] != user_id]
        if not candidates:
            return _resp({"queued": True, "tier": tier})

        # pick closest by abs diff then earliest enqueued
        candidates.sort(key=lambda c: (abs(int(c["score"])-score), c["enqueuedAt"]))
        other = candidates[0]
        # create match
        match_id = f"match-{uuid.uuid4().hex[:10]}"
        matches.put_item(Item={
            "matchId": match_id,
            "players": [user_id, other["userId"]],
            "scoreA": 0, "scoreB": 0, "state": "CREATED",
            "createdAt": now, "updatedAt": now, "ttl": now + 86400
        })
        # remove both from queue
        queue.delete_item(Key={"tier": tier, "scoreKey": sk})
        queue.delete_item(Key={"tier": tier, "scoreKey": other["scoreKey"]})
        return _resp({"matchId": match_id, "opponent": other["userId"]})

    if op == "cancel":
        # best-effort delete from all tiers
        for t in ["beginner","intermediate","master"]:
            queue.delete_item(Key={"tier": t, "scoreKey": body.get("scoreKey","99999#"+user_id)})
        return _resp({"ok": True})

    return _resp({"error":"unknown op"}, 400)
