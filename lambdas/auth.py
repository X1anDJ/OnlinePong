import os, json, time, uuid, boto3
dynamodb = boto3.resource('dynamodb')
players = dynamodb.Table(os.environ['PLAYERS_TABLE'])

def _resp(body, code=200):
    return {"statusCode": code, "headers": {"content-type":"application/json"}, "body": json.dumps(body)}

def handler(event, ctx):
    op = event.get("pathParameters", {}).get("op")  # signup|login|guest
    body = json.loads(event.get("body") or "{}")

    if op == "guest":
        user_id = f"guest-{uuid.uuid4().hex[:10]}"
        username = body.get("username", user_id)
        players.put_item(Item={
            "userId": user_id, "username": username, "score": 0, "tier": "beginner",
            "leaderboard": "LEADERBOARD", "createdAt": int(time.time()), "updatedAt": int(time.time())
        }, ConditionExpression="attribute_not_exists(userId)")
        token = f"token-{user_id}"
        return _resp({"userId": user_id, "username": username, "token": token})

    if op == "signup":
        username = body["username"]; password = body["password"]
        user_id = f"user-{uuid.uuid4().hex[:10]}"
        # naive: create player (no hashing/dup checks)
        players.put_item(Item={
            "userId": user_id, "username": username, "password": password,
            "score": 0, "tier": "beginner", "leaderboard": "LEADERBOARD",
            "createdAt": int(time.time()), "updatedAt": int(time.time())
        })
        return _resp({"userId": user_id, "token": f"token-{user_id}"})

    if op == "login":
        # naive: scan by username/password (fine for class)
        resp = players.scan(ProjectionExpression="userId,username,score,tier,password")
        for it in resp.get("Items", []):
            if it.get("username")==body["username"] and it.get("password")==body["password"]:
                return _resp({"userId": it["userId"], "token": f"token-{it['userId']}"})
        return _resp({"error":"invalid"}, 401)

    return _resp({"error":"unknown op"}, 400)
