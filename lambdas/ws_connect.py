import os, time, json, boto3
d = boto3.resource('dynamodb')
connections = d.Table(os.environ['CONNECTIONS_TABLE'])

def handler(event, ctx):
    connection_id = event["requestContext"]["connectionId"]
    # You can require a token+matchId via queryString if you want to validate here.
    ttl = int(time.time()) + 600
    connections.put_item(Item={"connectionId": connection_id, "ttl": ttl})
    return {"statusCode": 200, "body": "connected"}
