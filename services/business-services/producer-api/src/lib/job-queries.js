import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config.js';

export const EVENT_TO_STATE = {
  'Task Pending': 'pending',
  'Task Processing Started': 'processing',
  'Task Processing Failed': 'processing',
  'Task Updated': 'processing',
  'Task Completed': 'completed',
  'Task Submitted For Review': 'in_review',
  'Task Revision Requested': 'pending',
  'Task Approved': 'completed',
  'Task Failed': 'failed',
  'Task Timeout': 'failed',
  'Task Heartbeat': 'processing',
};

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

export async function getLatestTaskSaved(ddbClient, taskId, jobId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI5-index',
    KeyConditionExpression: 'GSI5PK = :pk AND begins_with(GSI5SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': 'EVENT#Task Saved',
      ':sk': `TENANT#${config.TENANT_ID}#TASK#${taskId}`,
    },
    ScanIndexForward: false,
    Limit: 20,
  }));
  const items = result.Items || [];
  if (!jobId) return items[0] || null;
  return items.find(item => item.properties?.jobId === jobId) || null;
}

export async function getLatestTaskEvent(ddbClient, taskId, jobId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    ScanIndexForward: false,
    Limit: 50,
  }));
  const items = (result.Items || [])
    .filter(item => item.eventType !== 'Task Saved')
    .filter(item => !jobId || item.properties?.jobId === jobId);
  return items[0] || null;
}

export async function getAllTaskEvents(ddbClient, taskId, jobId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    ScanIndexForward: true,
  }));
  const items = result.Items || [];
  if (!jobId) return items;
  return items.filter(item => item.properties?.jobId === jobId);
}
