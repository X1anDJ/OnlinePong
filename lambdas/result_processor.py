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

    # SQS can batch multiple records; handle each defensively
    for rec in event.get("Records", []):
        raw_body = rec.get("body")
        try:
            msg = json.loads(raw_body or "{}")
        except Exception as e:
            print(f"[WARN] Bad SQS body, skipping. body={raw_body!r} error={e}")
            continue
        
        try:
            match_id = msg.get("matchId")
            players_pair = msg.get("players") or []
            if not isinstance(players_pair, list) or len(players_pair) != 2:
                print(f"[WARN] Invalid players list in msg, skipping: {msg}")
                continue

            a, b = players_pair
            scoreA = int(msg.get("scoreA", 0))
            scoreB = int(msg.get("scoreB", 0))
            # scoring rule: each player gains their own points
            updates = [(a, scoreA), (b, scoreB)]

            for uid, delta in updates:
                try:
                    resp = players.get_item(Key={"userId": uid})
                    item = resp.get("Item") or {
                        "userId": uid,
                        "username": uid,  # fallback if not set yet
                        "score": 0,
                        "tier": "beginner",
                        "leaderboard": "LEADERBOARD",
                        "createdAt": now,
                    }

                    old_score = int(item.get("score", 0) or 0)
                    new_score = old_score + int(delta or 0)

                    item["score"] = new_score
                    item["tier"] = _tier(new_score)
                    item["leaderboard"] = "LEADERBOARD"
                    item["updatedAt"] = now

                    players.put_item(Item=item)
                    print(
                        f"[INFO] Updated player {uid}: "
                        f"{old_score} -> {new_score}, tier={item['tier']}"
                    )
                except Exception as e:
                    # Log but don't kill the whole batch
                    print(f"[ERROR] Failed updating player {uid} from msg {msg}: {e}")
                # delta = scoreA if uid==a else scoreB
                # p = players.get_item(Key={"userId": uid}).get("Item") or {"userId": uid, "username": uid, "score":0, "tier":"beginner","leaderboard":"LEADERBOARD"}
                # new_score = int(p.get("score",0)) + delta
                # p.update({"score": new_score, "tier": _tier(new_score), "updatedAt": int(time.time()), "leaderboard":"LEADERBOARD"})
                # players.put_item(Item=p)
            # store summary on match item
            # m = matches.get_item(Key={"matchId": msg["matchId"]}).get("Item") or {"matchId": msg["matchId"]}
            # m.update({"finalScoreA": scoreA, "finalScoreB": scoreB, "state": "FINISHED","updatedAt": now,})
            # matches.put_item(Item=m)

            # Update the Matches table with final scores / state
            if match_id:
                try:
                    m_resp = matches.get_item(Key={"matchId": match_id})
                    m_item = m_resp.get("Item") or {"matchId": match_id}
                    m_item.update(
                        {
                            "finalScoreA": scoreA,
                            "finalScoreB": scoreB,
                            "state": "FINISHED",
                            "updatedAt": now,
                        }
                    )
                    matches.put_item(Item=m_item)
                    print(f"[INFO] Updated match {match_id} with final scores.")
                except Exception as e:
                    print(f"[ERROR] Failed updating match {match_id} from msg {msg}: {e}")
        
        except Exception as e:
            # Catch any other unexpected errors for this message
            print(f"[ERROR] Unhandled exception for msg {msg}: {e}")

    return {"statusCode": 200}
