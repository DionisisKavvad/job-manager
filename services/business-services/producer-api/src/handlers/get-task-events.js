import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { success, error } from '../lib/response.js';
import { getAllTaskEvents } from '../lib/job-queries.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const { jobId, taskId } = event.pathParameters;

    const events = await getAllTaskEvents(ddbClient, taskId);

    if (events.length === 0) {
      return error(404, { error: 'No events found for task' });
    }

    const sanitized = events.map(evt => {
      const props = { ...evt.properties };
      const hasOutput = props.output != null;
      const hasDependencyOutputs = props.dependencyOutputs != null;
      delete props.output;
      delete props.dependencyOutputs;

      return {
        eventType: evt.eventType,
        timestamp: evt.timestamp,
        properties: { ...props, hasOutput, hasDependencyOutputs },
        context: evt.context || null,
      };
    });

    return success(200, { taskId, jobId, events: sanitized });
  } catch (err) {
    console.error('get-task-events error:', err);
    return error(500, { error: 'Internal server error' });
  }
}
