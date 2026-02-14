import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config.js';

export async function getJobDag(ddbClient, jobId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI5-index',
    KeyConditionExpression: 'GSI5PK = :pk AND begins_with(GSI5SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': 'EVENT#Job Saved',
      ':sk': `TENANT#${config.TENANT_ID}#JOB#${jobId}`,
    },
    ScanIndexForward: false,
    Limit: 1,
  }));

  const latest = result.Items?.[0];
  if (!latest) return null;

  const tasks = latest.properties.tasks;
  return { jobId, tasks, totalTasks: tasks.length };
}

export async function getAllJobEvents(ddbClient, jobId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
    ScanIndexForward: true,
  }));
  return result.Items || [];
}

export async function getLatestTaskEvent(ddbClient, taskId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    ScanIndexForward: false,
    Limit: 1,
  }));
  return result.Items?.[0] || null;
}
