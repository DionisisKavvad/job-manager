import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { buildEvent } from './utils/event-builder.js';
import {
  getLatestJobSaved,
  getAllJobEvents,
  getLatestTaskEvent,
  getJobFailureDetectedEvent,
  getTaskOutputEvent,
} from './utils/dag-queries.js';

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
const ebClient = new EventBridgeClient({});

export async function handler(event) {
  const detail = event.detail;
  const jobId = detail.properties?.jobId;

  // Standalone task — no job orchestration needed
  if (!jobId) return;

  // 1. Get latest Job Saved (full task DAG)
  const jobSaved = await getLatestJobSaved(ddbClient, jobId);
  if (!jobSaved) return;

  const taskDag = jobSaved.properties.tasks;

  // 2. Get current status of all tasks
  const taskStatuses = {};
  for (const task of taskDag) {
    const latestEvent = await getLatestTaskEvent(ddbClient, task.taskId);
    taskStatuses[task.taskId] = latestEvent
      ? EVENT_TO_STATE[latestEvent.eventType]
      : null;
  }

  // 3. Check for failure — emit detection event (idempotent, once per job)
  const failedTasks = taskDag.filter(t => taskStatuses[t.taskId] === 'failed');
  if (failedTasks.length > 0) {
    const existingFailure = await getJobFailureDetectedEvent(ddbClient, jobId);
    if (!existingFailure) {
      const failureEvent = buildEvent('Job Failure Detected', {
        entityId: jobId,
        entityType: 'JOB',
        properties: {
          jobId,
          failedTaskId: failedTasks[0].taskId,
          taskStatuses,
        },
      });

      await ebClient.send(new PutEventsCommand({
        Entries: [{
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: `task-workflow.${process.env.APP_NAME}`,
          DetailType: 'log-event',
          Detail: JSON.stringify(failureEvent),
          Time: new Date(),
        }],
      }));
    }
    // Don't return — continue dispatching ready tasks
  }

  // 4. Find tasks ready to dispatch
  const readyTasks = taskDag.filter(task => {
    if (taskStatuses[task.taskId]) return false; // already started or done
    return task.dependsOn.every(depId => taskStatuses[depId] === 'completed');
  });

  // 5. Emit Task Pending for ready tasks (task-enqueuer forwards to SQS)
  for (const task of readyTasks) {
    // Gather outputs from completed dependencies
    const dependencyOutputs = {};
    for (const depId of task.dependsOn) {
      const outputEvent = await getTaskOutputEvent(ddbClient, depId);
      if (outputEvent?.properties?.output) {
        dependencyOutputs[depId] = outputEvent.properties.output;
      }
    }

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
        dependsOn: task.dependsOn,
        dependencyOutputs,
      },
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: `task-workflow.${process.env.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(taskPendingEvent),
        Time: new Date(),
      }],
    }));
  }

  // 6. Check if all tasks completed → job done
  const allCompleted = taskDag.every(t => taskStatuses[t.taskId] === 'completed');
  if (allCompleted) {
    const jobCompletedEvent = buildEvent('Job Completed', {
      entityId: jobId,
      entityType: 'JOB',
      properties: {
        jobId,
        totalTasks: taskDag.length,
        taskStatuses,
      },
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: `task-workflow.${process.env.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(jobCompletedEvent),
        Time: new Date(),
      }],
    }));
  }
}
