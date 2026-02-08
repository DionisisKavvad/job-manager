import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config.js';

export async function getProcessingTasks(ddbClient, sinceTimestamp) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI4-index',
    KeyConditionExpression: 'GSI4PK = :pk AND GSI4SK > :since',
    ExpressionAttributeValues: {
      ':pk': 'EVENT#Task Processing Started',
      ':since': `TENANT#${config.TENANT_ID}#TIMESTAMP#${sinceTimestamp}`,
    },
  }));
  return result.Items || [];
}

export async function getLatestEvent(ddbClient, requestId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `TASK#${requestId}`,
    },
    ScanIndexForward: false,
    Limit: 1,
  }));
  return result.Items?.[0] || null;
}
