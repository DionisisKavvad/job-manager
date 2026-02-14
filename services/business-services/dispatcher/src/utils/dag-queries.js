import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.EVENTS_TABLE;

export async function getLatestJobSaved(ddbClient, jobId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI5-index',
    KeyConditionExpression: 'GSI5PK = :pk AND begins_with(GSI5SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': 'EVENT#Job Saved',
      ':sk': `TENANT#${process.env.TENANT_ID || 'gbInnovations'}#JOB#${jobId}`,
    },
    ScanIndexForward: false,
    Limit: 1,
  }));
  return result.Items?.[0] || null;
}

export async function getAllJobEvents(ddbClient, jobId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
    ScanIndexForward: true,
  }));
  return result.Items || [];
}

export async function getLatestTaskEvent(ddbClient, taskId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    ScanIndexForward: false,
    Limit: 1,
  }));
  return result.Items?.[0] || null;
}

export async function getAllTaskEvents(ddbClient, taskId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    ScanIndexForward: true,
  }));
  return result.Items || [];
}

export async function getJobFailureDetectedEvent(ddbClient, jobId) {
  const allEvents = await getAllJobEvents(ddbClient, jobId);
  return allEvents.find(e => e.eventType === 'Job Failure Detected') || null;
}

export async function getTaskOutputEvent(ddbClient, taskId) {
  const allEvents = await getAllTaskEvents(ddbClient, taskId);
  const submittedForReview = allEvents.filter(e => e.eventType === 'Task Submitted For Review');
  const completed = allEvents.find(e => e.eventType === 'Task Completed');

  if (submittedForReview.length > 0) {
    return submittedForReview[submittedForReview.length - 1];
  }
  return completed;
}
