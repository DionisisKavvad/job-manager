import { randomUUID } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { validateDag } from '../lib/dag-validator.js';
import { validateTaskNames } from '../lib/task-name-validator.js';
import { buildEvent } from '../lib/event-builder.js';
import { success, error } from '../lib/response.js';
import { config } from '../lib/config.js';

const sqsClient = new SQSClient({});
const ebClient = new EventBridgeClient({});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const body = JSON.parse(event.body);

    // 1. Validate DAG
    const validation = validateDag(body.tasks);
    if (!validation.valid) {
      return error(400, { errors: validation.errors });
    }

    // 2. Validate task names against registry
    const nameValidation = await validateTaskNames(ddbClient, body.tasks);
    if (!nameValidation.valid) {
      return error(400, { errors: nameValidation.errors });
    }

    const jobId = `job-${randomUUID()}`;
    const now = Date.now();
    const tasks = body.tasks;
    const rootTasks = tasks.filter(t => !t.dependsOn || t.dependsOn.length === 0);

    // 3. Emit "Job Created" event
    const jobCreatedEvent = buildEvent('Job Created', {
      entityId: jobId,
      entityType: 'JOB',
      properties: {
        jobId,
        tasks: tasks.map(t => ({
          taskId: t.taskId,
          name: t.name,
          dependsOn: t.dependsOn || [],
          input: t.input || {},
        })),
        totalTasks: tasks.length,
      },
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: config.EVENT_BUS_NAME,
        Source: `task-workflow.${config.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(jobCreatedEvent),
        Time: new Date(now),
      }],
    }));

    // 4. Enqueue root tasks + emit Task Pending
    for (const task of rootTasks) {
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: config.TASK_QUEUE_URL,
        MessageBody: JSON.stringify({
          taskId: task.taskId,
          jobId,
          name: task.name,
          input: task.input || {},
        }),
        MessageAttributes: {
          requestId: { DataType: 'String', StringValue: task.taskId },
        },
      }));

      const taskPendingEvent = buildEvent('Task Pending', {
        entityId: task.taskId,
        entityType: 'TASK',
        properties: {
          requestId: task.taskId,
          jobId,
          name: task.name,
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

    // 5. Response
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
