import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { success, error } from '../lib/response.js';
import { config } from '../lib/config.js';

const TASK_NAME_PATTERN = /^[a-zA-Z0-9-_]{1,64}$/;

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  try {
    const name = event.pathParameters.name;
    const body = JSON.parse(event.body);

    if (!TASK_NAME_PATTERN.test(name)) {
      return error(400, { error: `Invalid name format — must match ${TASK_NAME_PATTERN}` });
    }
    if (!body.description || typeof body.description !== 'string') {
      return error(400, { error: 'description is required' });
    }
    if (!body.tag || typeof body.tag !== 'string') {
      return error(400, { error: 'tag is required' });
    }

    const now = Date.now();
    await ddbClient.send(new PutCommand({
      TableName: config.TASK_DEFINITIONS_TABLE,
      Item: {
        name,
        description: body.description,
        tag: body.tag,
        requiresReview: body.requiresReview || false,
        repo: body.repo || null,
        updatedAt: now,
        createdAt: now,
      },
    }));

    return success(200, {
      name,
      description: body.description,
      tag: body.tag,
      requiresReview: body.requiresReview || false,
      repo: body.repo || null,
    });
  } catch (err) {
    console.error('put-task-definition error:', err);
    return error(500, { error: 'Internal server error' });
  }
}
