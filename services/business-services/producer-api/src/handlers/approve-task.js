import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { success, error } from '../lib/response.js';
import { config } from '../lib/config.js';
import { buildEvent } from '../lib/event-builder.js';
import { EVENT_TO_STATE, getLatestTaskEvent, getLatestTaskSaved, getJobDag } from '../lib/job-queries.js';

const ebClient = new EventBridgeClient({});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const { jobId, taskId } = event.pathParameters;

    // Validate task belongs to job
    const jobDag = await getJobDag(ddbClient, jobId);
    if (!jobDag) {
      return error(404, { error: 'Job not found' });
    }
    if (!jobDag.tasks.some(t => t.taskId === taskId)) {
      return error(404, { error: 'Task not found in job' });
    }

    // Validate task is in_review
    const latestEvent = await getLatestTaskEvent(ddbClient, taskId, jobId);
    const state = latestEvent ? EVENT_TO_STATE[latestEvent.eventType] : null;
    if (state !== 'in_review') {
      return error(409, { error: `Task is not in review (current state: ${state || 'unknown'})` });
    }

    const now = Date.now();

    // Emit Task Approved event (dispatcher listens for this)
    const approvedEvent = buildEvent('Task Approved', {
      entityId: taskId,
      entityType: 'TASK',
      properties: {
        requestId: taskId,
        jobId,
        approvedAt: now,
      },
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: config.EVENT_BUS_NAME,
        Source: `task-workflow.${config.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(approvedEvent),
        Time: new Date(now),
      }],
    }));

    // Update Task Saved with completed status
    const prevSaved = await getLatestTaskSaved(ddbClient, taskId, jobId);
    const prevProps = prevSaved?.properties || {};

    const taskSavedEvent = buildEvent('Task Saved', {
      entityId: taskId,
      entityType: 'TASK',
      properties: {
        ...prevProps,
        status: 'completed',
        approvedAt: now,
      },
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: config.EVENT_BUS_NAME,
        Source: `task-workflow.${config.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(taskSavedEvent),
        Time: new Date(now),
      }],
    }));

    return success(200, { taskId, status: 'approved' });
  } catch (err) {
    console.error('approve-task error:', err);
    return error(500, { error: 'Internal server error' });
  }
}
