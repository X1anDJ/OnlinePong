import os, boto3
d = boto3.resource('dynamodb')
connections = d.Table(os.environ['CONNECTIONS_TABLE'])

def handler(event, ctx):
    connection_id = event["requestContext"]["connectionId"]
    connections.delete_item(Key={"connectionId": connection_id})
    return {"statusCode": 200, "body": "disconnected"}
