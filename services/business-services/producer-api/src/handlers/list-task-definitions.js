import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { success, error } from '../lib/response.js';
import { config } from '../lib/config.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler() {
  try {
    const result = await ddbClient.send(new ScanCommand({
      TableName: config.TASK_DEFINITIONS_TABLE,
    }));

    return success(200, {
      definitions: (result.Items || []).map(item => ({
        name: item.name,
        description: item.description,
        tag: item.tag,
        requiresReview: item.requiresReview || false,
        repo: item.repo || null,
      })),
    });
  } catch (err) {
    console.error('list-task-definitions error:', err);
    return error(500, { error: 'Internal server error' });
  }
}
