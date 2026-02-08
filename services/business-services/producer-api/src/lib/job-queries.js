import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config.js';

export async function getJobDag(ddbClient, jobId) {
  const jobCreated = await getJobEvent(ddbClient, jobId, 'Job Created');
  if (!jobCreated) return null;

  const allJobEvents = await getAllJobEvents(ddbClient, jobId);
  const tasksAdded = allJobEvents.filter(e => e.eventType === 'Job Tasks Added');

  let tasks = [...jobCreated.properties.tasks];
  for (const added of tasksAdded) {
    tasks = [...tasks, ...added.properties.newTasks];
  }

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

async function getJobEvent(ddbClient, jobId, eventType) {
  const events = await getAllJobEvents(ddbClient, jobId);
  return events.find(e => e.eventType === eventType) || null;
}
