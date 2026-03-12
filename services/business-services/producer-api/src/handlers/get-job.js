import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { success, error } from '../lib/response.js';
import { config } from '../lib/config.js';
import { EVENT_TO_STATE, getLatestTaskSaved, getLatestTaskEvent } from '../lib/job-queries.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const jobId = event.pathParameters.jobId;

    // 1. Get latest Job Saved from GSI5
    const jobSavedResult = await ddbClient.send(new QueryCommand({
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

    const jobSaved = jobSavedResult.Items?.[0];
    if (!jobSaved) {
      return error(404, { error: 'Job not found' });
    }

    const allTasks = jobSaved.properties.tasks;

    // 2. Job-level status from GSI1 events
    const jobEventsResult = await ddbClient.send(new QueryCommand({
      TableName: config.TABLE_NAME,
      IndexName: 'GSI1-index',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
      ScanIndexForward: true,
    }));

    const jobEvents = jobEventsResult.Items || [];
    const jobCompleted = jobEvents.find(e => e.eventType === 'Job Completed');
    const jobFailure = jobEvents.find(e => e.eventType === 'Job Failure Detected');

    let jobStatus = 'processing';
    if (jobCompleted) jobStatus = 'completed';
    else if (jobFailure) jobStatus = 'partial_failure';

    // 3. Per-task status + enriched data from Task Saved (scoped to this job)
    const tasks = await Promise.all(allTasks.map(async task => {
      const [latestEvent, taskSaved] = await Promise.all([
        getLatestTaskEvent(ddbClient, task.taskId, jobId),
        getLatestTaskSaved(ddbClient, task.taskId, jobId),
      ]);

      const state = latestEvent ? EVENT_TO_STATE[latestEvent.eventType] : null;
      const savedProps = taskSaved?.properties || {};

      return {
        taskId: task.taskId,
        name: task.name,
        description: task.description,
        tag: task.tag,
        requiresReview: task.requiresReview || false,
        repo: task.repo || null,
        dependsOn: task.dependsOn,
        status: state || 'waiting',
        lastEventType: latestEvent?.eventType || null,
        lastEventAt: latestEvent?.timestamp || null,
        iteration: savedProps.iteration || 1,
        output: savedProps.output || null,
        summary: savedProps.summary || null,
        durationMs: savedProps.durationMs || null,
        usage: savedProps.usage || null,
        feedbackResult: savedProps.feedbackResult || null,
      };
    }));

    // 4. Progress summary
    const statusCounts = { waiting: 0, pending: 0, processing: 0, in_review: 0, completed: 0, failed: 0 };
    for (const task of tasks) {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
    }

    return success(200, {
      jobId,
      status: jobStatus,
      totalTasks: allTasks.length,
      progress: statusCounts,
      createdAt: jobSaved.timestamp,
      completedAt: jobCompleted?.timestamp || null,
      tasks,
    });
  } catch (err) {
    console.error('get-job error:', err);
    return error(500, { error: 'Internal server error' });
  }
}
