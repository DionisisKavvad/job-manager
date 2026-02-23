import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({});

export async function handler(event) {
  const detail = event.detail;
  const props = detail.properties;

  // TODO: define review message structure
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.TASK_QUEUE_URL,
    MessageBody: JSON.stringify({
      taskId: props.requestId,
      jobId: props.jobId,
      name: props.name || null,
      output: props.output || null,
      summary: props.summary || null,
      iteration: props.iteration || 1,
    }),
    MessageAttributes: {
      requestId: { DataType: 'String', StringValue: props.requestId },
    },
  }));
}
