import os, json, time, boto3
d = boto3.resource('dynamodb')
players = d.Table(os.environ['PLAYERS_TABLE'])
matches = d.Table(os.environ['MATCHES_TABLE'])

def _tier(score:int):
    if score < 20: return "beginner"
    if score < 40: return "intermediate"
    return "master"

def handler(event, ctx):
    now = int(time.time())
    for rec in event.get("Records", []):
        msg = json.loads(rec["body"])
        
        match_id = msg.get("matchId")
        players_pair = msg.get("players") or []
        if len(players_pair) != 2:
            # malformed message; skip
            continue

        a, b = players_pair
        scoreA = int(msg.get("scoreA", 0))
        scoreB = int(msg.get("scoreB", 0))
        # simple “win adds +2, loss +0” (or total points; adjust as you like)
        updates = [(a, scoreA), (b, scoreB)]

        for uid, delta in updates:
            # for demo: + (their points in match)
            resp = players.get_item(Key={"userId": uid})
            item = resp.get("Item") or {
                "userId": uid,
                "username": uid,
                "score": 0,
                "tier": "beginner",
                "leaderboard": "LEADERBOARD",
                "createdAt": now,
            }
            old_score = int(item.get("score", 0))
            new_score = old_score + int(delta)
            item["score"] = new_score
            item["tier"] = _tier(new_score)
            item["leaderboard"] = "LEADERBOARD"
            item["updatedAt"] = now
            players.put_item(Item=item)
            # delta = scoreA if uid==a else scoreB
            # p = players.get_item(Key={"userId": uid}).get("Item") or {"userId": uid, "username": uid, "score":0, "tier":"beginner","leaderboard":"LEADERBOARD"}
            # new_score = int(p.get("score",0)) + delta
            # p.update({"score": new_score, "tier": _tier(new_score), "updatedAt": int(time.time()), "leaderboard":"LEADERBOARD"})
            # players.put_item(Item=p)
        # store summary on match item
        m = matches.get_item(Key={"matchId": msg["matchId"]}).get("Item") or {"matchId": msg["matchId"]}
        m.update({"finalScoreA": scoreA, "finalScoreB": scoreB, "state": "FINISHED","updatedAt": now,})
        matches.put_item(Item=m)
    return {"statusCode": 200}
