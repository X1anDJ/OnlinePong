import os, json, time, boto3

d = boto3.resource('dynamodb')
history = d.Table(os.environ['MATCH_HISTORY_TABLE'])

def handler(event, ctx):
    for rec in event.get("Records", []):
        msg = json.loads(rec["body"])

        match_id = msg["matchId"]
        players = msg["players"]
        scoreA = int(msg["scoreA"])
        scoreB = int(msg["scoreB"])

        a, b = players
        now = int(time.time())

        # A's history
        history.put_item(Item={
            "userId": a,
            "timestamp": now,
            "matchId": match_id,
            "opponentId": b,
            "scoreFor": scoreA,
            "scoreAgainst": scoreB,
            "result": "WIN" if scoreA > scoreB else "LOSS"
        })

        # B's history
        history.put_item(Item={
            "userId": b,
            "timestamp": now,
            "matchId": match_id,
            "opponentId": a,
            "scoreFor": scoreB,
            "scoreAgainst": scoreA,
            "result": "WIN" if scoreB > scoreA else "LOSS"
        })

    return {"statusCode": 200}
