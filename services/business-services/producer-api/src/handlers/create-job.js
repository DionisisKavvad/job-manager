import { randomUUID } from 'node:crypto';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { validateDag } from '../lib/dag-validator.js';
import { buildEvent } from '../lib/event-builder.js';
import { success, error } from '../lib/response.js';
import { config } from '../lib/config.js';

const ebClient = new EventBridgeClient({});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const body = JSON.parse(event.body);

    // 1. Validate DAG (includes description/tag validation)
    const validation = validateDag(body.tasks);
    if (!validation.valid) {
      return error(400, { errors: validation.errors });
    }

    const jobId = `job-${randomUUID()}`;
    const now = Date.now();
    const tasks = body.tasks;
    const rootTasks = tasks.filter(t => !t.dependsOn || t.dependsOn.length === 0);

    // 2. Direct write "Job Saved" event for strong consistency
    const jobSavedEvent = buildEvent('Job Saved', {
      entityId: jobId,
      entityType: 'JOB',
      properties: {
        jobId,
        tasks: tasks.map(t => ({
          taskId: t.taskId,
          name: t.name,
          description: t.description,
          tag: t.tag,
          requiresReview: t.requiresReview || false,
          repo: t.repo || null,
          dependsOn: t.dependsOn || [],
          input: t.input || {},
        })),
        totalTasks: tasks.length,
      },
    });

    await ddbClient.send(new PutCommand({
      TableName: config.TABLE_NAME,
      Item: jobSavedEvent,
    }));

    // 3. Emit Task Pending for root tasks (task-enqueuer forwards to SQS)
    for (const task of rootTasks) {
      const taskPendingEvent = buildEvent('Task Pending', {
        entityId: task.taskId,
        entityType: 'TASK',
        properties: {
          requestId: task.taskId,
          jobId,
          name: task.name,
          description: task.description,
          tag: task.tag,
          requiresReview: task.requiresReview || false,
          repo: task.repo || null,
          input: task.input || {},
          dependsOn: [],
        },
      });

      await ebClient.send(new PutEventsCommand({
        Entries: [{
          EventBusName: config.EVENT_BUS_NAME,
          Source: `task-workflow.${config.APP_NAME}`,
          DetailType: 'log-event',
          Detail: JSON.stringify(taskPendingEvent),
          Time: new Date(now),
        }],
      }));
    }

    // 4. Response
    return success(201, {
      jobId,
      status: 'created',
      totalTasks: tasks.length,
      rootTasks: rootTasks.map(t => t.taskId),
      createdAt: now,
    });
  } catch (err) {
    console.error('create-job error:', err);
    return error(500, { error: 'Internal server error' });
  }
}
