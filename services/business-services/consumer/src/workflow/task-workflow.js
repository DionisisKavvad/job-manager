import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAwsConfig } from '../utils/aws-credentials.js';
import { buildPrompt } from './prompt-builder.js';
import { executeStep } from './agent-workflow.js';
import { WorkflowLogger } from './workflow-logger.js';
import { buildExecutionSummary } from './summary-builder.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient(getAwsConfig()));
const s3Client = new S3Client(getAwsConfig());

const S3_BUCKET = process.env.S3_BUCKET;
const TASK_DEFINITIONS_TABLE = process.env.TASK_DEFINITIONS_TABLE;
const DELETE_FILES_AFTER_UPLOAD = process.env.DELETE_FILES_AFTER_UPLOAD === 'true';

async function main() {
  const requestId = process.argv[2];
  const inputData = JSON.parse(process.argv[3] || '{}');

  const outputDir = join(process.cwd(), '.output', requestId);
  const artifactsDir = join(outputDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });

  const logger = new WorkflowLogger(requestId, outputDir);
  await logger.init();

  const startTime = Date.now();

  try {
    logger.info(`Starting task workflow for ${requestId}`);

    // 1. Load task definition
    const taskName = inputData.name;
    if (!taskName) {
      throw new Error(`No task name in input data`);
    }

    const taskDef = await getTaskDefinition(taskName);
    logger.info(`Loaded task definition: ${taskName} (tag: ${taskDef.tag})`);

    // 2. Build prompt
    const prompt = buildPrompt({
      taskDefinition: taskDef,
      input: inputData.input || {},
      dependencyOutputs: inputData.dependencyOutputs || {},
      iteration: inputData.iteration || 1,
      previousOutput: inputData.previousOutput || null,
      reviewFeedback: inputData.reviewFeedback || null,
    });

    logger.info(`Prompt built (${prompt.length} chars)`);

    // 3. Execute via Claude Agent SDK
    const result = await executeStep({
      name: taskName,
      constructedPrompt: prompt,
      maxTurns: 10,
      tools: [],
      timeout: parseInt(process.env.DEFAULT_TIMEOUT || '120000', 10),
    }, outputDir);

    logger.info(`Task completed in ${result.durationMs}ms`);

    // 4. Save result
    const resultPath = join(artifactsDir, 'task-result.json');
    await writeFile(resultPath, JSON.stringify(result.output, null, 2), 'utf8');

    // 5. Build and save summary
    const summary = buildExecutionSummary({
      requestId,
      taskName,
      startTime,
      endTime: Date.now(),
      result: result.output,
      usage: result.usage,
    });

    // 6. Upload to S3
    await uploadToS3(requestId, outputDir);

    logger.info('Upload complete');
    await logger.flush();

    // Write result to stdout for parent process
    console.log(JSON.stringify({
      success: true,
      output: result.output,
      usage: result.usage,
      durationMs: result.durationMs,
      summary,
    }));

    process.exit(0);
  } catch (error) {
    logger.error(`Task failed: ${error.message}`);
    await logger.flush();

    console.error(JSON.stringify({
      success: false,
      error: error.message,
      code: error.code,
    }));

    process.exit(1);
  }
}

async function getTaskDefinition(name) {
  const result = await ddbClient.send(new GetCommand({
    TableName: TASK_DEFINITIONS_TABLE,
    Key: { name },
  }));

  if (!result.Item) {
    throw new Error(`Unknown task type: "${name}" — not found in task registry`);
  }

  return result.Item;
}

async function uploadToS3(requestId, outputDir) {
  if (!S3_BUCKET) {
    console.log('No S3_BUCKET configured — skipping upload');
    return;
  }

  const dirs = ['artifacts', 'logs', 'traces'];

  for (const dir of dirs) {
    const dirPath = join(outputDir, dir);
    try {
      const files = await readdir(dirPath);
      for (const file of files) {
        const filePath = join(dirPath, file);
        const content = await readFile(filePath);
        const key = `task/logs/${requestId}/${dir}/${file}`;

        await s3Client.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: content,
          ContentType: file.endsWith('.json') ? 'application/json' : 'text/plain',
        }));
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

main();
