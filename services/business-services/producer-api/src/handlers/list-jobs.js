import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { success, error } from '../lib/response.js';
import { config } from '../lib/config.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(Math.max(parseInt(params.limit) || 20, 1), 100);
    const cursor = params.cursor
      ? JSON.parse(Buffer.from(params.cursor, 'base64url').toString())
      : undefined;
    const statusFilter = params.status || null;

    // Three parallel queries
    const [createdResult, completedResult, failureResult] = await Promise.all([
      queryEventType('Job Created', { limit, cursor }),
      queryEventType('Job Completed'),
      queryEventType('Job Failure Detected'),
    ]);

    const completedJobIds = new Set(
      completedResult.Items.map(e => e.properties.jobId)
    );
    const failedJobIds = new Set(
      failureResult.Items.map(e => e.properties.jobId)
    );

    // Build job list
    let jobs = createdResult.Items.map(event => {
      const jobId = event.properties.jobId;
      let status = 'processing';
      if (completedJobIds.has(jobId)) status = 'completed';
      else if (failedJobIds.has(jobId)) status = 'partial_failure';

      return {
        jobId,
        status,
        totalTasks: event.properties.totalTasks,
        createdAt: event.timestamp,
      };
    });

    // Filter by status
    if (statusFilter) {
      jobs = jobs.filter(j => j.status === statusFilter);
    }

    // Pagination cursor
    const nextCursor = createdResult.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(createdResult.LastEvaluatedKey)).toString('base64url')
      : null;

    return success(200, { jobs, nextCursor });
  } catch (err) {
    console.error('list-jobs error:', err);
    return error(500, { error: 'Internal server error' });
  }
}

async function queryEventType(eventType, options = {}) {
  const params = {
    TableName: config.TABLE_NAME,
    IndexName: 'GSI4-index',
    KeyConditionExpression: 'GSI4PK = :pk AND begins_with(GSI4SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `EVENT#${eventType}`,
      ':sk': `TENANT#${config.TENANT_ID}#TIMESTAMP#`,
    },
    ScanIndexForward: false,
  };

  if (options.limit) params.Limit = options.limit;
  if (options.cursor) params.ExclusiveStartKey = options.cursor;

  return ddbClient.send(new QueryCommand(params));
}
