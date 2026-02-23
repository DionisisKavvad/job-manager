import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { validateDag } from '../lib/dag-validator.js';
import { getJobDag, getAllJobEvents, getLatestTaskEvent } from '../lib/job-queries.js';
import { buildEvent } from '../lib/event-builder.js';
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

const ebClient = new EventBridgeClient({});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const jobId = event.pathParameters.jobId;
    const body = JSON.parse(event.body);
    const newTasks = body.tasks;
    const now = Date.now();

    // 1. Get existing job DAG
    const existingDag = await getJobDag(ddbClient, jobId);
    if (!existingDag) {
      return error(404, { error: 'Job not found' });
    }

    // 2. Check job not completed
    const jobEvents = await getAllJobEvents(ddbClient, jobId);
    const isCompleted = jobEvents.some(e => e.eventType === 'Job Completed');
    if (isCompleted) {
      return error(409, { error: 'Job already completed — cannot add tasks' });
    }

    // 3. Validate new tasks against existing IDs (dupes, deps, cycles)
    const existingIds = new Set(existingDag.tasks.map(t => t.taskId));
    const validation = validateDag(newTasks, { existingIds });
    if (!validation.valid) {
      return error(400, { errors: validation.errors });
    }

    const combinedTasks = [...existingDag.tasks, ...newTasks];

    // 4. Direct write "Job Saved" with DAG structure only
    const jobSavedEvent = buildEvent('Job Saved', {
      entityId: jobId,
      entityType: 'JOB',
      properties: {
        jobId,
        tasks: combinedTasks.map(t => ({
          taskId: t.taskId,
          name: t.name,
          dependsOn: t.dependsOn || [],
        })),
        totalTasks: combinedTasks.length,
      },
    });

    await ddbClient.send(new PutCommand({
      TableName: config.TABLE_NAME,
      Item: jobSavedEvent,
    }));

    // 5. Emit Task Saved per NEW task (full snapshot)
    for (const task of newTasks) {
      const taskSavedEvent = buildEvent('Task Saved', {
        entityId: task.taskId,
        entityType: 'TASK',
        properties: {
          taskId: task.taskId,
          jobId,
          name: task.name,
          description: task.description,
          tag: task.tag,
          requiresReview: task.requiresReview || false,
          repo: task.repo || null,
          input: task.input || {},
          dependsOn: task.dependsOn || [],
          status: 'pending',
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
    }

    // 6. Check which new tasks are immediately ready
    const readyTasks = [];

    for (const task of newTasks) {
      const deps = task.dependsOn || [];
      if (deps.length === 0) {
        readyTasks.push(task);
        continue;
      }

      const allDepsCompleted = await Promise.all(
        deps.map(async depId => {
          if (newTasks.some(t => t.taskId === depId)) return false;
          const latestEvent = await getLatestTaskEvent(ddbClient, depId);
          return latestEvent && EVENT_TO_STATE[latestEvent.eventType] === 'completed';
        })
      );

      if (allDepsCompleted.every(Boolean)) {
        readyTasks.push(task);
      }
    }

    // 7. Emit Task Pending for ready tasks (task-enqueuer reads Task Saved for details)
    for (const task of readyTasks) {
      const taskPendingEvent = buildEvent('Task Pending', {
        entityId: task.taskId,
        entityType: 'TASK',
        properties: {
          requestId: task.taskId,
          jobId,
          name: task.name,
          dependsOn: task.dependsOn || [],
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

    return success(200, {
      jobId,
      addedTasks: newTasks.map(t => t.taskId),
      immediatelyReady: readyTasks.map(t => t.taskId),
      totalTasksNow: combinedTasks.length,
    });
  } catch (err) {
    console.error('add-tasks error:', err);
    return error(500, { error: 'Internal server error' });
  }
}
