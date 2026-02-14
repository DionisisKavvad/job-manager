import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({});

export async function handler(event) {
  const detail = event.detail;
  const props = detail.properties;

  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.TASK_QUEUE_URL,
    MessageBody: JSON.stringify({
      taskId: props.requestId,
      jobId: props.jobId,
      name: props.name,
      description: props.description,
      tag: props.tag,
      requiresReview: props.requiresReview || false,
      repo: props.repo || null,
      input: props.input || {},
      dependencyOutputs: props.dependencyOutputs || {},
    }),
    MessageAttributes: {
      requestId: { DataType: 'String', StringValue: props.requestId },
    },
  }));
}
