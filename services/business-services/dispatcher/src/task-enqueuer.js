import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getLatestTaskSaved } from './utils/dag-queries.js';

const sqsClient = new SQSClient({});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function handler(event) {
  const detail = event.detail;
  const props = detail.properties;
  const taskId = props.requestId;

  // Task Saved is emitted via EventBridge → event service → DynamoDB.
  // Allow time for it to be persisted before querying.
  await delay(1500);

  const taskSaved = await getLatestTaskSaved(ddbClient, taskId);
  if (!taskSaved) {
    console.error(`[ENQUEUER] No Task Saved found for ${taskId} — cannot build SQS message`);
    return;
  }

  const taskProps = taskSaved.properties;

  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.TASK_QUEUE_URL,
    MessageBody: JSON.stringify({
      taskId: taskProps.taskId,
      jobId: taskProps.jobId,
      name: taskProps.name,
      description: taskProps.description,
      tag: taskProps.tag,
      requiresReview: taskProps.requiresReview || false,
      repo: taskProps.repo || null,
      input: taskProps.input || {},
      dependencyOutputs: taskProps.dependencyOutputs || {},
      allowedTools: taskProps.allowedTools || null,
      maxTurns: taskProps.maxTurns || null,
      feedbackCommands: taskProps.feedbackCommands || null,
    }),
    MessageAttributes: {
      requestId: { DataType: 'String', StringValue: taskId },
    },
  }));
}
