import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { success, error } from '../lib/response.js';
import { config } from '../lib/config.js';
import { buildEvent } from '../lib/event-builder.js';
import { EVENT_TO_STATE, getLatestTaskEvent, getLatestTaskSaved, getJobDag } from '../lib/job-queries.js';

const MAX_ITERATIONS = 5;
const MAX_FEEDBACK_LENGTH = 5000;

const ebClient = new EventBridgeClient({});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const { jobId, taskId } = event.pathParameters;

    // Parse and validate body
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return error(400, { error: 'Invalid JSON body' });
    }

    const feedback = body.feedback;
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      return error(400, { error: 'feedback is required' });
    }
    if (feedback.length > MAX_FEEDBACK_LENGTH) {
      return error(400, { error: `feedback must be ${MAX_FEEDBACK_LENGTH} characters or fewer` });
    }

    // Validate task belongs to job
    const jobDag = await getJobDag(ddbClient, jobId);
    if (!jobDag) {
      return error(404, { error: 'Job not found' });
    }
    if (!jobDag.tasks.some(t => t.taskId === taskId)) {
      return error(404, { error: 'Task not found in job' });
    }

    // Validate task is in_review
    const latestEvent = await getLatestTaskEvent(ddbClient, taskId);
    const state = latestEvent ? EVENT_TO_STATE[latestEvent.eventType] : null;
    if (state !== 'in_review') {
      return error(409, { error: `Task is not in review (current state: ${state || 'unknown'})` });
    }

    // Get current Task Saved for iteration + output
    const prevSaved = await getLatestTaskSaved(ddbClient, taskId);
    const prevProps = prevSaved?.properties || {};
    const currentIteration = prevProps.iteration || 1;
    const nextIteration = currentIteration + 1;

    if (nextIteration > MAX_ITERATIONS) {
      return error(409, { error: `Max iterations reached (${MAX_ITERATIONS})` });
    }

    const now = Date.now();

    // 1. Emit Task Revision Requested to EventBridge
    const revisionEvent = buildEvent('Task Revision Requested', {
      entityId: taskId,
      entityType: 'TASK',
      properties: {
        requestId: taskId,
        jobId,
        feedback: feedback.trim(),
        iteration: currentIteration,
      },
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: config.EVENT_BUS_NAME,
        Source: `task-workflow.${config.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(revisionEvent),
        Time: new Date(now),
      }],
    }));

    // 2. Write Task Saved directly to DynamoDB (NOT via EventBridge)
    //    This guarantees the updated Task Saved is persisted before the enqueuer reads it.
    const taskSavedEvent = buildEvent('Task Saved', {
      entityId: taskId,
      entityType: 'TASK',
      properties: {
        ...prevProps,
        iteration: nextIteration,
        reviewFeedback: feedback.trim(),
        previousOutput: prevProps.output || null,
        output: null,
        summary: null,
        durationMs: null,
        usage: null,
        feedbackResult: null,
        status: 'pending',
      },
    });

    await ddbClient.send(new PutCommand({
      TableName: config.TABLE_NAME,
      Item: taskSavedEvent,
    }));

    // 3. Emit Task Pending to EventBridge (triggers task-enqueuer → SQS → worker)
    const pendingEvent = buildEvent('Task Pending', {
      entityId: taskId,
      entityType: 'TASK',
      properties: {
        requestId: taskId,
        jobId,
        name: prevProps.name,
        dependsOn: prevProps.dependsOn || [],
      },
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: config.EVENT_BUS_NAME,
        Source: `task-workflow.${config.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(pendingEvent),
        Time: new Date(now),
      }],
    }));

    return success(200, {
      taskId,
      status: 'revision_requested',
      iteration: nextIteration,
    });
  } catch (err) {
    console.error('request-revision error:', err);
    return error(500, { error: 'Internal server error' });
  }
}
