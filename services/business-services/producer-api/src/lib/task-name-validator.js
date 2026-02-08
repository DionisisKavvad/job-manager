import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config.js';

export async function validateTaskNames(ddbClient, tasks) {
  const names = [...new Set(tasks.map(t => t.name))];

  const results = await Promise.all(
    names.map(name =>
      ddbClient.send(new GetCommand({
        TableName: config.TASK_DEFINITIONS_TABLE,
        Key: { name },
      }))
    )
  );

  const missing = names.filter((name, i) => !results[i].Item);
  if (missing.length > 0) {
    return { valid: false, errors: [`Unknown task types: ${missing.join(', ')}`] };
  }

  return { valid: true };
}
