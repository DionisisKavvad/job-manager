import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { config } from './lib/config.js';
import { getProcessingTasks, getLatestEvent } from './lib/task-queries.js';
import { classifyHealth } from './lib/health-classifier.js';
import { sendAlerts, emitHealthCheckEvent } from './lib/slack-alerting.js';

const TERMINAL_EVENTS = ['Task Completed', 'Task Failed', 'Task Timeout', 'Task Approved'];

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler() {
  const now = Date.now();
  const lookbackFrom = now - config.LOOKBACK_WINDOW_MS;

  // 1. Get all "Task Processing Started" events within lookback window
  const processingEvents = await getProcessingTasks(ddbClient, lookbackFrom);

  // 2. For each, get latest event and classify health
  const taskChecks = [];

  for (const processingEvent of processingEvents) {
    const requestId = processingEvent.properties.requestId;
    const startedAt = processingEvent.properties.startedAt || processingEvent.timestamp;

    const latestEvent = await getLatestEvent(ddbClient, requestId);

    // Skip if task already reached terminal state
    if (TERMINAL_EVENTS.includes(latestEvent?.eventType)) {
      continue;
    }

    const elapsed = now - startedAt;
    const timeSinceLastEvent = now - (latestEvent?.timestamp || startedAt);

    const health = classifyHealth({ elapsed, timeSinceLastEvent });

    taskChecks.push({
      requestId,
      health,
      elapsed,
      timeSinceLastEvent,
      lastEventType: latestEvent?.eventType || 'Task Processing Started',
      lastEventTimestamp: latestEvent?.timestamp || startedAt,
      workerId: latestEvent?.context?.workerId || processingEvent.context?.workerId,
      startedAt,
      lastActivity: latestEvent?.properties?.lastActivity || null,
    });
  }

  // 3. Alert on unhealthy tasks
  const critical = taskChecks.filter(t => t.health === 'critical');
  const overtime = taskChecks.filter(t => t.health === 'overtime');
  const warnings = taskChecks.filter(t => t.health === 'warning');
  const healthy = taskChecks.filter(t => t.health === 'healthy');

  if (critical.length > 0 || overtime.length > 0) {
    await sendAlerts({
      level: 'critical',
      message: `${critical.length} stuck tasks, ${overtime.length} overtime tasks`,
      tasks: [...critical, ...overtime],
    });
  }

  if (warnings.length > 0) {
    await sendAlerts({
      level: 'warning',
      message: `${warnings.length} tasks with delayed heartbeats`,
      tasks: warnings,
    });
  }

  // 4. Emit summary event
  const summary = {
    checkedAt: now,
    totalProcessing: taskChecks.length,
    healthy: healthy.length,
    warning: warnings.length,
    critical: critical.length,
    overtime: overtime.length,
    tasks: taskChecks,
  };

  await emitHealthCheckEvent(summary);

  console.log(`Health check: ${taskChecks.length} tasks — ${healthy.length} healthy, ${warnings.length} warning, ${critical.length} critical, ${overtime.length} overtime`);

  return summary;
}

export async function checkSingle(event) {
  const { requestId } = event;
  if (!requestId) return { error: 'requestId required' };

  const now = Date.now();
  const latestEvent = await getLatestEvent(ddbClient, requestId);

  if (!latestEvent) return { requestId, status: 'not_found' };

  const elapsed = now - (latestEvent.properties?.startedAt || latestEvent.timestamp);
  const timeSinceLastEvent = now - latestEvent.timestamp;

  return {
    requestId,
    currentState: latestEvent.eventType,
    health: classifyHealth({ elapsed, timeSinceLastEvent }),
    elapsed,
    timeSinceLastEvent,
    lastEventType: latestEvent.eventType,
    workerId: latestEvent.context?.workerId,
    lastActivity: latestEvent.properties?.lastActivity || null,
  };
}
