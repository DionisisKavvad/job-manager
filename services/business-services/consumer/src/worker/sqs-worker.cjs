const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { getAwsConfig } = require('../utils/aws-credentials.cjs');

// Load .env if present
try { require('dotenv').config({ path: join(__dirname, '../../.env') }); } catch {}

const EVENT_TO_STATE = {
  'Task Pending': 'pending',
  'Task Processing Started': 'processing',
  'Task Processing Failed': 'processing',
  'Task Updated': 'processing',
  'Task Completed': 'completed',
  'Task Submitted For Review': 'in_review',
  'Task Revision Requested': 'pending',
  'Task Approved': 'completed',
  'Task Failed': 'failed',
  'Task Timeout': 'failed',
  'Task Heartbeat': 'processing',
};

const TERMINAL_STATES = new Set(['completed', 'failed']);

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9-_]{1,256}$/;

// Config
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
const MAX_MESSAGES = parseInt(process.env.MAX_MESSAGES || '1', 10);
const WAIT_TIME_SECONDS = parseInt(process.env.WAIT_TIME_SECONDS || '20', 10);
const VISIBILITY_EXTENSION_INTERVAL = parseInt(process.env.VISIBILITY_EXTENSION_INTERVAL || '20000', 10);
const VISIBILITY_EXTENSION_AMOUNT = parseInt(process.env.VISIBILITY_EXTENSION_AMOUNT || '30', 10);
const CLAUDE_TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT || '200000', 10);
const MAX_CONCURRENT_CLAUDE = parseInt(process.env.MAX_CONCURRENT_CLAUDE || '3', 10);
const MAX_MESSAGE_RETRIES = parseInt(process.env.MAX_MESSAGE_RETRIES || '3', 10);
const MAX_TASK_ITERATIONS = parseInt(process.env.MAX_TASK_ITERATIONS || '5', 10);
const TABLE_NAME = process.env.DYNAMODB_EVENTS_TABLE_NAME || process.env.EVENTS_TABLE;

const awsConfig = getAwsConfig();
const sqsClient = new SQSClient(awsConfig);
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient(awsConfig));

// Dynamic ESM imports (loaded at startup)
let classifyError, emitEvent;

// Environment allowlist for child process
const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'PWD',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'LC_COLLATE',
  'TERM', 'COLORTERM', 'FORCE_COLOR',
  'NODE_ENV',
  'CLAUDE_CODE_PATH', 'CLAUDE_CONFIG_DIR', 'CLAUDE_TIMEOUT',
  'MAX_CONCURRENT_CLAUDE', 'CLAUDE_SKIP_PERMISSIONS', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_MODEL', 'DEFAULT_TIMEOUT',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION',
  'S3_BUCKET', 'DELETE_FILES_AFTER_UPLOAD',
  'EVENTBRIDGE_BUS_NAME', 'TENANT_ID', 'APP_NAME', 'TASK_DEFINITIONS_TABLE',
];

let running = true;
let activeProcesses = 0;

async function loadModules() {
  const errorMod = await import('../utils/error-classifier.js');
  classifyError = errorMod.classifyError;
  const eventMod = await import('../services/event-emitter-service.js');
  emitEvent = eventMod.emitEvent;
}

function getFilteredEnv() {
  const filtered = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      filtered[key] = process.env[key];
    }
  }
  return filtered;
}

async function getLatestTaskEvent(requestId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${requestId}` },
    ScanIndexForward: false,
    Limit: 1,
  }));
  return result.Items?.[0] || null;
}

async function checkIdempotency(requestId) {
  const latestEvent = await getLatestTaskEvent(requestId);
  if (!latestEvent) return { proceed: true, reason: 'first-time' };

  const state = EVENT_TO_STATE[latestEvent.eventType];

  if (TERMINAL_STATES.has(state)) {
    return { proceed: false, reason: 'terminal', state };
  }

  if (state === 'processing') {
    const effectiveUntil = latestEvent.properties?.effectiveUntil;
    if (effectiveUntil && Date.now() < effectiveUntil * 1000) {
      return { proceed: false, reason: 'active-worker', state };
    }
    return { proceed: true, reason: 'expired-lock' };
  }

  return { proceed: true, reason: 'retryable-state' };
}

async function processMessage(message) {
  const body = JSON.parse(message.Body);
  const requestId = message.MessageAttributes?.requestId?.StringValue
    || body.taskId
    || 'unknown';

  const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount || '1', 10);
  const jobId = body.jobId || null;
  const iteration = body.iteration || 1;

  console.log(`[WORKER] Processing: ${requestId} (attempt ${receiveCount}, iteration ${iteration})`);

  // Validate requestId
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    console.error(`[WORKER] Invalid requestId: ${requestId}`);
    await emitEvent('Task Failed', {
      entityId: requestId,
      entityType: 'TASK',
      properties: { requestId, ...(jobId && { jobId }), error: 'Invalid requestId format', errorCategory: 'validation', source: 'worker' },
    });
    await deleteMessage(message);
    return;
  }

  // Check max retries
  if (receiveCount > MAX_MESSAGE_RETRIES) {
    console.log(`[WORKER] Max retries exceeded for ${requestId}`);
    // SQS will move to DLQ; DLQ Lambda handles terminal event
    return;
  }

  // Check max iterations
  if (iteration > MAX_TASK_ITERATIONS) {
    console.log(`[WORKER] Max iterations exceeded for ${requestId}`);
    await emitEvent('Task Failed', {
      entityId: requestId,
      entityType: 'TASK',
      properties: { requestId, ...(jobId && { jobId }), error: `Max iterations exceeded (${MAX_TASK_ITERATIONS})`, errorCategory: 'validation', source: 'worker' },
    });
    await deleteMessage(message);
    return;
  }

  // Idempotency check
  const idempotency = await checkIdempotency(requestId);
  if (!idempotency.proceed) {
    console.log(`[WORKER] Skipping ${requestId}: ${idempotency.reason} (state: ${idempotency.state})`);
    if (idempotency.reason === 'terminal') {
      await deleteMessage(message);
    }
    return;
  }

  // Calculate effectiveUntil
  const effectiveUntil = Math.floor(Date.now() / 1000) + Math.floor(VISIBILITY_EXTENSION_AMOUNT * 1.5);

  // Emit Task Processing Started
  const workerId = `worker-${process.pid}`;
  await emitEvent('Task Processing Started', {
    entityId: requestId,
    entityType: 'TASK',
    properties: {
      requestId,
      ...(jobId && { jobId }),
      effectiveUntil,
      workerId,
      processId: null, // will be updated when child spawns
    },
    context: { workerId },
  });

  // Start visibility extension + heartbeat
  let extensionFailures = 0;
  let heartbeatNumber = 0;
  const startTime = Date.now();

  const extensionInterval = setInterval(async () => {
    try {
      await sqsClient.send(new ChangeMessageVisibilityCommand({
        QueueUrl: SQS_QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: VISIBILITY_EXTENSION_AMOUNT,
      }));
      extensionFailures = 0;
      heartbeatNumber++;

      const newEffectiveUntil = Math.floor(Date.now() / 1000) + Math.floor(VISIBILITY_EXTENSION_AMOUNT * 1.5);
      await emitEvent('Task Heartbeat', {
        entityId: requestId,
        entityType: 'TASK',
        properties: {
          requestId,
          effectiveUntil: newEffectiveUntil,
          heartbeatNumber,
          elapsedMs: Date.now() - startTime,
          workerId,
          processId: childPid,
          memoryUsage: process.memoryUsage(),
          lastActivity: lastActivity,
        },
        context: { workerId },
      });
    } catch (err) {
      extensionFailures++;
      console.error(`[WORKER] Visibility extension failed (${extensionFailures}): ${err.message}`);
      if (extensionFailures >= 3) {
        clearInterval(extensionInterval);
      }
    }
  }, VISIBILITY_EXTENSION_INTERVAL);

  let childPid = null;
  let lastActivity = { type: 'waiting', timestamp: Date.now() };
  let timedOut = false;

  try {
    // Spawn child process
    const inputData = JSON.stringify(body);
    const filteredEnv = getFilteredEnv();

    const result = await new Promise((resolve, reject) => {
      const child = spawn('node', ['src/workflow/task-workflow.js', requestId, inputData], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: filteredEnv,
        cwd: join(__dirname, '../..'),
      });

      childPid = child.pid;
      child.stdin.end();

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        lastActivity = { type: 'step_running', timestamp: Date.now() };
        process.stdout.write(`[WORKFLOW:${requestId}] ${text}`);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(`[WORKFLOW:${requestId}] ${text}`);
      });

      // Timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        console.log(`[WORKER] Timeout for ${requestId} — sending SIGTERM`);
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            console.log(`[WORKER] Force-killing ${requestId}`);
            child.kill('SIGKILL');
          }
        }, 5000);
      }, CLAUDE_TIMEOUT);

      child.on('close', (code, signal) => {
        clearTimeout(timeoutHandle);
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          const err = new Error(stderr || `Child exited with code ${code}`);
          err.code = code;
          err.signal = signal;
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        reject(err);
      });
    });

    // Success — parse output
    let output = {};
    let usage = {};
    let durationMs = Date.now() - startTime;

    try {
      const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
      output = parsed.output || {};
      usage = parsed.usage || {};
      durationMs = parsed.durationMs || durationMs;
    } catch {}

    // Check requiresReview — need task definition
    const taskDef = await getTaskDefinition(body.name);
    const requiresReview = taskDef?.requiresReview || false;

    if (requiresReview) {
      await emitEvent('Task Submitted For Review', {
        entityId: requestId,
        entityType: 'TASK',
        properties: {
          requestId,
          ...(jobId && { jobId }),
          iteration,
          output,
          summary: typeof output === 'object' ? JSON.stringify(output).substring(0, 200) : String(output).substring(0, 200),
          ...(taskDef.repo && { repo: taskDef.repo }),
          durationMs,
          usage,
        },
        context: { workerId },
      });
    } else {
      await emitEvent('Task Completed', {
        entityId: requestId,
        entityType: 'TASK',
        properties: {
          requestId,
          ...(jobId && { jobId }),
          iteration,
          output,
          durationMs,
          exitCode: 0,
          usage,
        },
        context: { workerId },
      });
    }

    await deleteMessage(message);
  } catch (err) {
    if (timedOut) {
      await emitEvent('Task Timeout', {
        entityId: requestId,
        entityType: 'TASK',
        properties: {
          requestId,
          ...(jobId && { jobId }),
          timeoutMs: CLAUDE_TIMEOUT,
          elapsedMs: Date.now() - startTime,
          signal: 'SIGKILL',
        },
        context: { workerId },
      });
      await deleteMessage(message);
    } else {
      const classification = classifyError(err);

      if (classification.retryable) {
        await emitEvent('Task Processing Failed', {
          entityId: requestId,
          entityType: 'TASK',
          properties: {
            requestId,
            ...(jobId && { jobId }),
            attemptNumber: receiveCount,
            error: err.message?.substring(0, 500),
            errorCategory: classification.category,
          },
          context: { workerId },
        });
        // Keep message for SQS retry
      } else {
        await emitEvent('Task Failed', {
          entityId: requestId,
          entityType: 'TASK',
          properties: {
            requestId,
            ...(jobId && { jobId }),
            error: err.message?.substring(0, 500),
            errorCategory: classification.category,
            retryCount: receiveCount,
            source: 'worker',
          },
          context: { workerId },
        });
        await deleteMessage(message);
      }
    }
  } finally {
    clearInterval(extensionInterval);
    activeProcesses--;
  }
}

async function getTaskDefinition(name) {
  if (!name) return null;
  try {
    const { DynamoDBDocumentClient: DocClient, GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const result = await ddbClient.send(new GetCommand({
      TableName: process.env.TASK_DEFINITIONS_TABLE,
      Key: { name },
    }));
    return result.Item || null;
  } catch {
    return null;
  }
}

async function deleteMessage(message) {
  try {
    await sqsClient.send(new DeleteMessageCommand({
      QueueUrl: SQS_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    }));
  } catch (err) {
    console.error(`[WORKER] Failed to delete message: ${err.message}`);
  }
}

async function processConcurrently(messages, handler, maxConcurrent) {
  const executing = new Set();

  for (const message of messages) {
    if (executing.size >= maxConcurrent) {
      await Promise.race(executing);
    }

    const promise = handler(message).then(
      () => executing.delete(promise),
      () => executing.delete(promise)
    );
    executing.add(promise);
  }

  await Promise.allSettled(executing);
}

async function pollLoop() {
  await loadModules();
  console.log(`[WORKER] Started (pid: ${process.pid}, queue: ${SQS_QUEUE_URL})`);

  while (running) {
    try {
      const result = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MaxNumberOfMessages: MAX_MESSAGES,
        WaitTimeSeconds: WAIT_TIME_SECONDS,
        MessageAttributeNames: ['All'],
        AttributeNames: ['All'],
      }));

      const messages = result.Messages || [];

      if (messages.length > 0) {
        console.log(`[WORKER] Received ${messages.length} message(s)`);
        activeProcesses += messages.length;
        await processConcurrently(messages, processMessage, MAX_CONCURRENT_CLAUDE);
      }
    } catch (err) {
      console.error(`[WORKER] Poll error: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Brief pause between polls
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Graceful shutdown
process.on('SIGINT', () => { running = false; process.exit(0); });
process.on('SIGTERM', () => { running = false; process.exit(0); });
process.on('uncaughtException', (err) => {
  console.error('[WORKER] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[WORKER] Unhandled rejection:', err);
  process.exit(1);
});

pollLoop().catch(err => {
  console.error('[WORKER] Fatal error:', err);
  process.exit(1);
});
