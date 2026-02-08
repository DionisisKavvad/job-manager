import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { buildEvent } from './utils/event-builder.js';

const ebClient = new EventBridgeClient({});

export async function handler(event) {
  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    const body = JSON.parse(message.body || '{}');

    const requestId = message.messageAttributes?.requestId?.stringValue
      || body.taskId
      || 'unknown';

    const jobId = body.jobId || null;

    const taskFailedEvent = buildEvent('Task Failed', {
      entityId: requestId,
      entityType: 'TASK',
      properties: {
        requestId,
        ...(jobId && { jobId }),
        error: 'Max retries exhausted, moved to DLQ',
        errorCategory: 'max-retries',
        retryCount: parseInt(message.attributes?.ApproximateReceiveCount || '3', 10),
        source: 'dlq',
      },
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: `task-workflow.${process.env.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(taskFailedEvent),
        Time: new Date(),
      }],
    }));
  }
}
