import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { success, error } from '../lib/response.js';
import { config } from '../lib/config.js';

const EVENT_TO_STATE = {
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

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const jobId = event.pathParameters.jobId;

    // 1. Get all job-level events
    const jobEventsResult = await ddbClient.send(new QueryCommand({
      TableName: config.TABLE_NAME,
      IndexName: 'GSI1-index',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
      ScanIndexForward: true,
    }));

    const jobEvents = jobEventsResult.Items || [];
    if (jobEvents.length === 0) {
      return error(404, { error: 'Job not found' });
    }

    // 2. Build full task list from Job Created + Job Tasks Added
    const jobCreated = jobEvents.find(e => e.eventType === 'Job Created');
    const tasksAdded = jobEvents.filter(e => e.eventType === 'Job Tasks Added');

    let allTasks = [...jobCreated.properties.tasks];
    for (const addedEvent of tasksAdded) {
      allTasks = [...allTasks, ...addedEvent.properties.newTasks];
    }

    // 3. Job-level status
    const jobCompleted = jobEvents.find(e => e.eventType === 'Job Completed');
    const jobFailure = jobEvents.find(e => e.eventType === 'Job Failure Detected');

    let jobStatus = 'processing';
    if (jobCompleted) jobStatus = 'completed';
    else if (jobFailure) jobStatus = 'partial_failure';

    // 4. Per-task status
    const tasks = await Promise.all(allTasks.map(async task => {
      const latestResult = await ddbClient.send(new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: 'GSI1-index',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `TASK#${task.taskId}` },
        ScanIndexForward: false,
        Limit: 1,
      }));

      const latestEvent = latestResult.Items?.[0];
      const state = latestEvent ? EVENT_TO_STATE[latestEvent.eventType] : null;

      return {
        taskId: task.taskId,
        name: task.name,
        dependsOn: task.dependsOn,
        status: state || 'waiting',
        lastEventType: latestEvent?.eventType || null,
        lastEventAt: latestEvent?.timestamp || null,
      };
    }));

    // 5. Progress summary
    const statusCounts = { waiting: 0, pending: 0, processing: 0, in_review: 0, completed: 0, failed: 0 };
    for (const task of tasks) {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
    }

    return success(200, {
      jobId,
      status: jobStatus,
      totalTasks: allTasks.length,
      progress: statusCounts,
      createdAt: jobCreated.timestamp,
      completedAt: jobCompleted?.timestamp || null,
      tasks,
    });
  } catch (err) {
    console.error('get-job error:', err);
    return error(500, { error: 'Internal server error' });
  }
}
