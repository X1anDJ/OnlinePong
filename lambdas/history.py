import os, json, boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Key

d = boto3.resource('dynamodb')
history = d.Table(os.environ['MATCH_HISTORY_TABLE'])

def _resp(body, code=200):
    return {
        "statusCode": code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body)
    }

def handler(event, ctx):
    qs = event.get("queryStringParameters") or {}
    user_id = qs.get("userId")

    if not user_id:
        return _resp({"error": "userId required"}, 400)

    resp = history.query(
        KeyConditionExpression=Key("userId").eq(user_id),
        ScanIndexForward=False  # newest first
    )

    def _coerce(v):
        if isinstance(v, Decimal):
            # history timestamps/scores are integers
            return int(v)
        return v

    items = []
    for raw in resp.get("Items", []):
        items.append({
            "matchId": raw.get("matchId"),
            "opponentId": raw.get("opponentId"),
            "scoreFor": _coerce(raw.get("scoreFor", 0)),
            "scoreAgainst": _coerce(raw.get("scoreAgainst", 0)),
            "result": raw.get("result"),
            "timestamp": _coerce(raw.get("timestamp", 0))
        })

    return _resp({"items": items})
