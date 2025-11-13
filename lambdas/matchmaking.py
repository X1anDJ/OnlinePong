import os
import json
import time
import uuid
import boto3
from boto3.dynamodb.conditions import Key  # for proper query

d = boto3.resource('dynamodb')
players = d.Table(os.environ['PLAYERS_TABLE'])
queue = d.Table(os.environ['QUEUE_TABLE'])
matches = d.Table(os.environ['MATCHES_TABLE'])
sqs = boto3.client('sqs')
RESULTS_QUEUE_URL = os.environ['RESULTS_QUEUE_URL']


def _tier(score: int) -> str:
    if score < 20:
        return "beginner"
    if score < 40:
        return "intermediate"
    return "master"


def _pad(n: int) -> str:
    return f"{n:05d}"


def _resp(body, code=200):
    return {
        "statusCode": code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


def handler(event, ctx):
    op = (event.get("pathParameters") or {}).get("op")
    body_raw = event.get("body") or "{}"
    try:
        body = json.loads(body_raw)
    except Exception:
        body = {}
    user_id = body.get("userId")

    # basic guard
    if op in ("start", "cancel", "check") and not user_id:
        return _resp({"error": "userId required"}, 400)

    # ============ START MATCHMAKING ============
    if op == "start":
        # read score
        p = players.get_item(Key={"userId": user_id}).get("Item")
        if not p:
            return _resp({"error": "player not found"}, 404)

        score = int(p.get("score", 0))
        tier = _tier(score)
        now = int(time.time())

        # write self into queue with TTL 15s
        sk = f"{_pad(score)}#{user_id}"
        queue.put_item(
            Item={
                "tier": tier,
                "scoreKey": sk,
                "userId": user_id,
                "score": score,
                "enqueuedAt": now,
                "ttl": now + 15,
            }
        )

        # try to find closest in same tier
        q = queue.query(
            KeyConditionExpression=Key("tier").eq(tier)
        )
        items = q.get("Items", []) or []

        # drop our own record from candidates
        candidates = [it for it in items if it.get("userId") != user_id]

        # if nobody else is waiting, we are queued
        if not candidates:
            # frontend will poll /matchmaking/check
            return _resp({"queued": True, "tier": tier})

        # pick closest by abs diff then earliest enqueued
        candidates.sort(
            key=lambda c: (abs(int(c.get("score", 0)) - score), c.get("enqueuedAt", now))
        )
        other = candidates[0]

        # create match
        match_id = f"match-{uuid.uuid4().hex[:10]}"
        matches.put_item(
            Item={
                "matchId": match_id,
                "players": [user_id, other["userId"]],
                "scoreA": 0,
                "scoreB": 0,
                "state": "CREATED",
                "createdAt": now,
                "updatedAt": now,
                "ttl": now + 86400,
            }
        )

        # remove both from queue
        queue.delete_item(Key={"tier": tier, "scoreKey": sk})
        queue.delete_item(Key={"tier": tier, "scoreKey": other["scoreKey"]})

        # IMPORTANT: both players now have an active match,
        # but only this caller gets the response immediately.
        # The other player will discover it via /matchmaking/check.
        return _resp({"matchId": match_id, "opponent": other["userId"]})

    # ============ CANCEL MATCHMAKING ============
    if op == "cancel":
        # best-effort delete from all tiers; scoreKey might not be known client-side
        for t in ["beginner", "intermediate", "master"]:
            try:
                queue.delete_item(
                    Key={"tier": t, "scoreKey": body.get("scoreKey", f"99999#{user_id}")}
                )
            except Exception:
                pass
        return _resp({"ok": True})

    # ============ CHECK FOR MATCH (polling) ============
    if op == "check":
        # naive scan: find most recent non-finished match that includes this user
        # This was failing before because "state" is a reserved word.
        # We alias it using ExpressionAttributeNames.
        resp = matches.scan(
            ProjectionExpression="#mid, players, #st, createdAt",
            ExpressionAttributeNames={
                "#mid": "matchId",
                "#st": "state",
            }
        )
        items = resp.get("Items", []) or []

        # newest first
        items.sort(key=lambda m: int(m.get("createdAt", 0)), reverse=True)

        for m in items:
            ps = m.get("players") or []
            state = m.get("state", "UNKNOWN")
            if not isinstance(ps, list):
                continue
            # we consider 'CREATED' and 'PLAYING' as "active" for checking
            if user_id in ps and state in ("CREATED", "PLAYING"):
                other = None
                if len(ps) == 2:
                    if ps[0] == user_id:
                        other = ps[1]
                    elif ps[1] == user_id:
                        other = ps[0]
                return _resp({
                    "matchId": m["matchId"],
                    "opponent": other,
                })

        # if we reach here, either:
        # - no match yet, OR
        # - the match already finished by the time we checked
        return _resp({"queued": True})

    # ============ UNKNOWN OP ============
    return _resp({"error": "unknown op"}, 400)
