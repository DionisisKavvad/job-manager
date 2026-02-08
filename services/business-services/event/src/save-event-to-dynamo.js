import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.EVENTS_TABLE;

export async function handler(event) {
  const detail = event.detail;
  const item = { ...detail, receivedAt: Date.now() };
  await ddbClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}
