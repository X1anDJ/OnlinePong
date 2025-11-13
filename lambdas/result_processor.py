import os, json, time, boto3
d = boto3.resource('dynamodb')
players = d.Table(os.environ['PLAYERS_TABLE'])
matches = d.Table(os.environ['MATCHES_TABLE'])

def _tier(score:int):
    if score < 20: return "beginner"
    if score < 40: return "intermediate"
    return "master"

def handler(event, ctx):
    for rec in event.get("Records", []):
        msg = json.loads(rec["body"])
        scoreA, scoreB = int(msg["scoreA"]), int(msg["scoreB"])
        a, b = msg["players"]
        # simple “win adds +2, loss +0” (or total points; adjust as you like)
        winner = a if scoreA > scoreB else b
        for uid in [a,b]:
            # for demo: + (their points in match)
            delta = scoreA if uid==a else scoreB
            p = players.get_item(Key={"userId": uid}).get("Item") or {"userId": uid, "username": uid, "score":0, "tier":"beginner","leaderboard":"LEADERBOARD"}
            new_score = int(p.get("score",0)) + delta
            p.update({"score": new_score, "tier": _tier(new_score), "updatedAt": int(time.time()), "leaderboard":"LEADERBOARD"})
            players.put_item(Item=p)
        # store summary on match item
        m = matches.get_item(Key={"matchId": msg["matchId"]}).get("Item") or {"matchId": msg["matchId"]}
        m.update({"finalScoreA": scoreA, "finalScoreB": scoreB, "state": "FINISHED"})
        matches.put_item(Item=m)
    return {"statusCode": 200}
