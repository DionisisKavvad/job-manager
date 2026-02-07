# Health Check & Heartbeat Monitoring

Heartbeat events emitted by the consumer and a scheduled Lambda that detects stuck/overtime tasks. Extends the core consumer ([consumer-architecture.md](./consumer-architecture.md)) and shared event system ([event-system.md](./event-system.md)).

---

## 1. Heartbeat Events

For long-running tasks (>1 hour workflows), we need visibility into whether a task is actually making progress or is stuck.

### Problem

A task in `processing` state could be:
1. **Actively working** — Claude SDK is executing, steps are progressing
2. **Stuck** — child process hung, OOM killed, network issue
3. **Slow but healthy** — large prompt, complex workflow, but making progress

Without heartbeats, we can't distinguish between these.

### Heartbeat Events

Piggyback on the **existing visibility extension mechanism**. The sqs-worker already calls `ChangeMessageVisibility` periodically. At the same time, emit a heartbeat event:

```javascript
// Event type: "Task Heartbeat"
// Emitted every VISIBILITY_EXTENSION_INTERVAL (e.g. every 2-5 minutes)

{
  PK:     "TENANT#gbinnovations",
  SK:     "TIMESTAMP#{ts}#EVENT#{eventId}",
  GSI1PK: "TASK#{requestId}",
  GSI1SK: "TASK#TIMESTAMP#{ts}",
  GSI2PK: "APP#task-workflow",
  GSI2SK: "TIMESTAMP#{ts}",
  GSI3PK: "APP#task-workflow",
  GSI3SK: "TASK#{requestId}#TIMESTAMP#{ts}",
  GSI4PK: "EVENT#Task Heartbeat",
  GSI4SK: "TENANT#gbinnovations#TIMESTAMP#{ts}",
  // GSI5-7 follow same pattern...

  entityId: "{requestId}",
  entityType: "TASK",
  eventType: "Task Heartbeat",
  properties: {
    requestId: "req-123",
    currentState: "PROCESSING",
    elapsedMs: 360000,                    // 6 minutes since start
    heartbeatNumber: 3,                    // 3rd heartbeat
    effectiveUntil: 1707300645,            // now + VISIBILITY_EXTENSION_AMOUNT * 1.5
    workerId: "worker-instance-001",
    processId: 12345,                      // child process PID
    memoryUsage: { rss: 256000000 },       // from process.memoryUsage()

    // Progress info from child process stdout parsing
    lastActivity: {
      type: "step_running",                // or "sdk_query", "waiting"
      stepName: "color-tags",
      timestamp: 1707300540
    }
  }
}
```

**Where to emit**: In `sqs-worker.cjs`, inside the visibility extension interval callback — it already runs periodically, just add an EventBridge emit alongside the `ChangeMessageVisibility` call.

**Progress info**: The worker already streams child process stdout. Parse the output for step markers (step started/completed log lines) and include the last known activity in the heartbeat.

---

## 2. Health Check Lambda

### Serverless Framework Deployment

Deployed to AWS via Serverless Framework. Runs on a schedule, queries DynamoDB directly, alerts on stuck/overtime tasks.

#### Project Structure

```
task-health-check/
├── serverless.yml
├── package.json
├── src/
│   ├── health-check.js          # Lambda entry point
│   ├── lib/
│   │   ├── task-queries.js      # DynamoDB query helpers
│   │   ├── health-classifier.js
│   │   └── slack-alerting.js    # Slack bot alerts
│   └── config.js                # Thresholds, table names
└── README.md
```

#### `serverless.yml`

```yaml
service: task-health-check

build:
  esbuild: true

custom:
  resources: ${file(../../../config/config.${self:provider.stage}.yml)}
  schedules:
    healthCheck:
      rate:
        dev: "rate(365 days)"
        prod: "rate(5 minutes)"
      enabled:
        dev: false
        prod: true

provider:
  name: aws
  runtime: nodejs22.x
  stage: ${opt:stage, 'dev'}
  region: ${opt:region, 'eu-west-1'}
  profile: ${self:custom.resources.profile, 'default'}
  stackTags:
    Team: task-health-check-${self:provider.stage}
  environment:
    ENVIRONMENT: ${self:provider.stage}
    SERVICE_NAME: ${self:service}
    EVENTS_TABLE: !Ref EventsTable
    TASK_QUEUE_URL: !Ref TaskQueue
    TENANT_ID: gbInnovations
    APP_NAME: task-workflow
    EVENT_BUS_NAME: ${self:service}-${self:provider.stage}
    SLACK_BOT_TOKEN: ${self:custom.resources.slackBotToken}
    ALERT_CHANNEL: ${self:custom.resources.alertChannel}

functions:
  health-check:
    handler: src/health-check.handler
    description: Checks health of running tasks — alerts on stuck/overtime via Slack
    timeout: 60
    memorySize: 256
    events:
      - schedule:
          rate: ${self:custom.schedules.healthCheck.rate.${self:provider.stage}}
          enabled: ${self:custom.schedules.healthCheck.enabled.${self:provider.stage}}
    iamRoleStatements:
      - Effect: Allow
        Action:
          - dynamodb:Query
        Resource:
          - arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:provider.environment.EVENTS_TABLE}
          - arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:provider.environment.EVENTS_TABLE}/index/*
      - Effect: Allow
        Action:
          - events:PutEvents
        Resource: "*"

  # Manual invoke: sls invoke -f health-check-single --data '{"requestId":"req-123"}'
  health-check-single:
    handler: src/health-check.checkSingle
    description: Check health of a specific task by requestId
    timeout: 30
    memorySize: 256
    iamRoleStatements:
      - Effect: Allow
        Action:
          - dynamodb:Query
        Resource:
          - arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:provider.environment.EVENTS_TABLE}
          - arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:provider.environment.EVENTS_TABLE}/index/*

resources:
  Resources:
    # SQS Queue (Standard — at-least-once delivery, idempotency via DynamoDB events)
    TaskQueue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: task-queue-${self:provider.stage}
        VisibilityTimeout: 900              # 15 min — must exceed max task duration
        MessageRetentionPeriod: 1209600     # 14 days
        ReceiveMessageWaitTimeSeconds: 20   # Long polling
        RedrivePolicy:
          deadLetterTargetArn: !GetAtt TaskDLQ.Arn
          maxReceiveCount: 3

    TaskDLQ:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: task-queue-dlq-${self:provider.stage}
        MessageRetentionPeriod: 1209600     # 14 days

    # DynamoDB Events Table (event-sourced — shared across services)
    EventsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: events-${self:provider.stage}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: PK
            AttributeType: S
          - AttributeName: SK
            AttributeType: S
          - AttributeName: GSI1PK
            AttributeType: S
          - AttributeName: GSI1SK
            AttributeType: S
          - AttributeName: GSI2PK
            AttributeType: S
          - AttributeName: GSI2SK
            AttributeType: S
          - AttributeName: GSI3PK
            AttributeType: S
          - AttributeName: GSI3SK
            AttributeType: S
          - AttributeName: GSI4PK
            AttributeType: S
          - AttributeName: GSI4SK
            AttributeType: S
          - AttributeName: GSI5PK
            AttributeType: S
          - AttributeName: GSI5SK
            AttributeType: S
          - AttributeName: GSI6PK
            AttributeType: S
          - AttributeName: GSI6SK
            AttributeType: S
          - AttributeName: GSI7PK
            AttributeType: S
          - AttributeName: GSI7SK
            AttributeType: S
        KeySchema:
          - AttributeName: PK
            KeyType: HASH
          - AttributeName: SK
            KeyType: RANGE
        GlobalSecondaryIndexes:
          - IndexName: GSI1-index
            KeySchema:
              - AttributeName: GSI1PK
                KeyType: HASH
              - AttributeName: GSI1SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
          - IndexName: GSI2-index
            KeySchema:
              - AttributeName: GSI2PK
                KeyType: HASH
              - AttributeName: GSI2SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
          - IndexName: GSI3-index
            KeySchema:
              - AttributeName: GSI3PK
                KeyType: HASH
              - AttributeName: GSI3SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
          - IndexName: GSI4-index
            KeySchema:
              - AttributeName: GSI4PK
                KeyType: HASH
              - AttributeName: GSI4SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
          - IndexName: GSI5-index
            KeySchema:
              - AttributeName: GSI5PK
                KeyType: HASH
              - AttributeName: GSI5SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
          - IndexName: GSI6-index
            KeySchema:
              - AttributeName: GSI6PK
                KeyType: HASH
              - AttributeName: GSI6SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
          - IndexName: GSI7-index
            KeySchema:
              - AttributeName: GSI7PK
                KeyType: HASH
              - AttributeName: GSI7SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
        TimeToLiveSpecification:
          AttributeName: ttl
          Enabled: true

    # EventBridge Bus
    TaskHealthCheckEventBus:
      Type: AWS::Events::EventBus
      Properties:
        Name: ${self:service}-${self:provider.stage}

  Outputs:
    TaskQueueUrl:
      Value: !Ref TaskQueue
      Export:
        Name: task-queue-queue-url-${self:provider.stage}
    TaskQueueArn:
      Value: !GetAtt TaskQueue.Arn
      Export:
        Name: task-queue-queue-arn-${self:provider.stage}
    EventsTableName:
      Value: !Ref EventsTable
      Export:
        Name: events-table-name-${self:provider.stage}
    EventsTableArn:
      Value: !GetAtt EventsTable.Arn
      Export:
        Name: events-table-arn-${self:provider.stage}
```

#### `src/config.js`

```javascript
export const config = {
  // How often we expect a heartbeat (matches visibility extension interval)
  HEARTBEAT_MAX_AGE_MS: 5 * 60 * 1000,      // 5 minutes

  // Alert if no heartbeat for this long
  ALERT_THRESHOLD_MS: 10 * 60 * 1000,        // 10 minutes

  // Max expected task duration before flagging as overtime
  TASK_MAX_DURATION_MS: 60 * 60 * 1000,      // 1 hour

  // Only check tasks started within this window (ignore ancient events)
  LOOKBACK_WINDOW_MS: 24 * 60 * 60 * 1000,   // 24 hours

  // DynamoDB
  TABLE_NAME: process.env.EVENTS_TABLE,
  TENANT_ID: process.env.TENANT_ID,
  APP_NAME: process.env.APP_NAME || 'task-workflow',

  // Slack
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  ALERT_CHANNEL: process.env.ALERT_CHANNEL,
};
```

#### `src/handler.js`

```javascript
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { config } from './config.js';
import { getProcessingTasks, getLatestEvent } from './lib/task-queries.js';
import { classifyHealth } from './lib/health-classifier.js';
import { sendAlerts, emitHealthCheckEvent } from './lib/slack-alerting.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function check(event) {
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
    if (['Task Completed', 'Task Failed'].includes(latestEvent.eventType)) {
      continue;
    }

    const elapsed = now - startedAt;
    const timeSinceLastEvent = now - latestEvent.timestamp;

    const health = classifyHealth({ elapsed, timeSinceLastEvent });

    taskChecks.push({
      requestId,
      health,
      elapsed,
      timeSinceLastEvent,
      lastEventType: latestEvent.eventType,
      lastEventTimestamp: latestEvent.timestamp,
      workerId: latestEvent.context?.workerId,
      startedAt,
      lastActivity: latestEvent.properties?.lastActivity || null
    });
  }

  // 3. Alert on unhealthy tasks
  const critical = taskChecks.filter(t => t.health === 'critical');
  const overtime = taskChecks.filter(t => t.health === 'overtime');
  const warnings = taskChecks.filter(t => t.health === 'warning');
  const healthy  = taskChecks.filter(t => t.health === 'healthy');

  if (critical.length > 0 || overtime.length > 0) {
    await sendAlerts({
      level: 'critical',
      message: `${critical.length} stuck tasks, ${overtime.length} overtime tasks`,
      tasks: [...critical, ...overtime]
    });
  }

  if (warnings.length > 0) {
    await sendAlerts({
      level: 'warning',
      message: `${warnings.length} tasks with delayed heartbeats`,
      tasks: warnings
    });
  }

  // 4. Emit summary event to EventBridge
  const summary = {
    checkedAt: now,
    totalProcessing: taskChecks.length,
    healthy: healthy.length,
    warning: warnings.length,
    critical: critical.length,
    overtime: overtime.length,
    tasks: taskChecks
  };

  await emitHealthCheckEvent(summary);

  console.log(`Health check: ${taskChecks.length} tasks — ${healthy.length} healthy, ${warnings.length} warning, ${critical.length} critical, ${overtime.length} overtime`);

  return summary;
}

// Manual single-task check
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
    lastActivity: latestEvent.properties?.lastActivity || null
  };
}
```

#### `src/lib/task-queries.js`

```javascript
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config.js';

export async function getProcessingTasks(ddbClient, sinceTimestamp) {
  // GSI4: Event type + tenant (all "Task Processing Started" events)
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI4-index',
    KeyConditionExpression: 'GSI4PK = :pk AND GSI4SK > :since',
    ExpressionAttributeValues: {
      ':pk': 'EVENT#Task Processing Started',
      ':since': `TENANT#${config.TENANT_ID}#TIMESTAMP#${sinceTimestamp}`
    }
  }));
  return result.Items || [];
}

export async function getLatestEvent(ddbClient, requestId) {
  // GSI1: Entity-scoped — all events for this task, latest first
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `TASK#${requestId}`
    },
    ScanIndexForward: false,
    Limit: 1
  }));
  return result.Items?.[0] || null;
}
```

#### `src/lib/health-classifier.js`

```javascript
import { config } from '../config.js';

export function classifyHealth({ elapsed, timeSinceLastEvent }) {
  // Overtime takes priority — task running too long regardless of heartbeat
  if (elapsed > config.TASK_MAX_DURATION_MS) {
    return 'overtime';
  }

  // Classify by heartbeat freshness
  if (timeSinceLastEvent <= config.HEARTBEAT_MAX_AGE_MS) {
    return 'healthy';
  }

  if (timeSinceLastEvent <= config.ALERT_THRESHOLD_MS) {
    return 'warning';
  }

  return 'critical';
}
```

#### `src/lib/slack-alerting.js`

```javascript
import { WebClient } from '@slack/web-api';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { config } from '../config.js';

const slack = new WebClient(config.SLACK_BOT_TOKEN);
const ebClient = new EventBridgeClient({});

export async function sendAlerts({ level, message, tasks }) {
  if (!config.SLACK_BOT_TOKEN || !config.ALERT_CHANNEL) {
    console.warn('Slack not configured — skipping alert');
    return;
  }

  const emoji = level === 'critical' ? ':red_circle:' : ':warning:';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} Task Health: ${message}` }
    },
    {
      type: 'divider'
    },
    ...tasks.map(t => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${t.requestId}*`,
          `Health: \`${t.health}\``,
          `Elapsed: ${Math.round(t.elapsed / 60000)}min`,
          `Last event: ${t.lastEventType} (${Math.round(t.timeSinceLastEvent / 60000)}min ago)`,
          `Worker: ${t.workerId || 'unknown'}`
        ].join('\n')
      }
    }))
  ];

  try {
    await slack.chat.postMessage({
      channel: config.ALERT_CHANNEL,
      text: `${emoji} ${level.toUpperCase()}: ${message}`,
      blocks
    });
  } catch (error) {
    console.error('Failed to send Slack alert:', error.message);
  }
}

export async function emitHealthCheckEvent(summary) {
  if (!process.env.EVENT_BUS_NAME) return;

  await ebClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: process.env.EVENT_BUS_NAME,
      Source: 'task-health-check',
      DetailType: 'Task Health Check',
      Detail: JSON.stringify(summary),
      Time: new Date()
    }]
  }));
}
```

#### Deploy

```bash
cd task-health-check

# Deploy
npx serverless deploy --stage dev
npx serverless deploy --stage prod

# Test manually
npx serverless invoke -f health-check --stage dev
npx serverless invoke -f health-check-single --stage dev --data '{"requestId":"req-123"}'

# View logs
npx serverless logs -f health-check --stage prod --tail
```

### Health Classification

```
Task started
  │
  │  Every 2-5 min: "Task Heartbeat" event (from sqs-worker)
  │     │
  │     ├── Last heartbeat < 5 min ago    → HEALTHY
  │     ├── Last heartbeat 5-10 min ago   → WARNING
  │     ├── Last heartbeat > 10 min ago   → CRITICAL
  │     └── Total elapsed > 1 hour        → OVERTIME
  │
  ▼
Task completed/failed
```

| Health | Condition | Action |
|---|---|---|
| **healthy** | Heartbeat within last 5 min | None — task is progressing |
| **warning** | No heartbeat for 5-10 min | Log, continue monitoring |
| **critical** | No heartbeat for >10 min | Slack alert to ALERT_CHANNEL |
| **overtime** | Running for >1 hour total | Slack alert to ALERT_CHANNEL |

### Integration Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ sqs-worker.cjs (EC2/local)                                       │
│                                                                   │
│  Visibility Extension Interval (already exists):                  │
│    ├── ChangeMessageVisibility() ← already happening             │
│    └── emit("Task Heartbeat") ← NEW: ~5 lines of code           │
│                                                                   │
│  Parse child stdout for progress: ← NEW: ~15 lines of code      │
│    lastActivity = { stepName, type, timestamp }                   │
└──────────────────────┬───────────────────────────────────────────┘
                       │ EventBridge
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ DynamoDB (existing table)                                        │
│                                                                   │
│  TASK#req-123 events:                                             │
│    Task Pending              (t=0)     ← from producer           │
│    Task Processing Started   (t=1min)  ← from sqs-worker        │
│    Task Heartbeat            (t=3min)                             │
│    Task Heartbeat            (t=6min)                             │
│    Task Heartbeat            (t=9min)                             │
│    Task Completed            (t=11min) ← from sqs-worker        │
└──────────────────────────────────────────────────────────────────┘
                       ▲
                       │ Query (every 5 min)
                       │
┌──────────────────────────────────────────────────────────────────┐
│ Health Check Lambda (AWS — Serverless Framework)                  │
│                                                                   │
│  Trigger: EventBridge Scheduler (rate: 5 minutes)                 │
│                                                                   │
│  1. Query GSI4 → "Task Processing Started" events (last 24h)     │
│  2. For each: Query GSI1 → latest event (Limit: 1)               │
│  3. Classify: healthy / warning / critical / overtime             │
│  4. Alert if critical/overtime → Slack bot                         │
│  5. Emit "Task Health Check" summary → EventBridge                │
│                                                                   │
│  Also: manual invoke for single task debugging                    │
│    sls invoke -f healthCheckOnDemand --data '{"requestId":"..."}'│
└──────────────────────────────────────────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  Slack Bot     │──→ #alerts channel (ALERT_CHANNEL)
              └────────────────┘
```
