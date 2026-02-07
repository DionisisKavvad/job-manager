# Event System

Shared event infrastructure used by all components: consumer (sqs-worker), producer, health check Lambda, dispatcher Lambda.

All events flow through one path: **Sender → EventBridge → Lambda → DynamoDB**.

---

## Event Types

### Workflow-level events

| Event | When | Emitted By |
|-------|------|------------|
| `Task Pending` | Before sending to SQS | Producer |
| `Task Processing Started` | Worker spawns child process | sqs-worker |
| `Task Processing Failed` | Retryable error from child process — attempt-level, not terminal | sqs-worker |
| `Task Completed` | Child exits with code 0 | sqs-worker |
| `Task Failed` | Non-retryable error from child process, or DLQ (terminal) | sqs-worker / DLQ Lambda |
| `Task Timeout` | Worker kills child process externally (SIGTERM → SIGKILL) | sqs-worker |
| `Task Heartbeat` | On visibility extension | sqs-worker |

### Job-level events

| Event | When | Emitted By |
|-------|------|------------|
| `Job Created` | Multi-task request submitted | Producer API |
| `Job Tasks Added` | Additional tasks added to existing job | Producer API |
| `Job Completed` | All tasks in job completed | Dispatcher Lambda |
| `Job Failure Detected` | Non-retryable task failure detected — job is not terminal, in-progress tasks continue | Dispatcher Lambda |

### Health check events

| Event | When | Emitted By |
|-------|------|------------|
| `Task Health Check` | Scheduled health check summary | Health Check Lambda |

---

## Event Structure

Every event carries **all keys**, computed by the sender:

```javascript
{
  // Primary keys
  PK:     "TENANT#gbinnovations",
  SK:     "TIMESTAMP#1767453739640#EVENT#ddf71f63-b036-4ac7-ad0f-77a7fdfca352",

  // GSI1: Entity queries — all events for this task
  GSI1PK: "TASK#req-123",
  GSI1SK: "TASK#TIMESTAMP#1767453739640",

  // GSI2: App timeline (all events for this app, chronological)
  GSI2PK: "APP#task-workflow",
  GSI2SK: "TIMESTAMP#1767453739640",

  // GSI3: App-scoped entity queries (app + specific task)
  GSI3PK: "APP#task-workflow",
  GSI3SK: "TASK#req-123#TIMESTAMP#1767453739640",

  // GSI4: Event type + tenant (broadest event type query)
  GSI4PK: "EVENT#Task Processing Started",
  GSI4SK: "TENANT#gbinnovations#TIMESTAMP#1767453739640",

  // GSI5: Event type + tenant + entity
  GSI5PK: "EVENT#Task Processing Started",
  GSI5SK: "TENANT#gbinnovations#TASK#req-123#TIMESTAMP#1767453739640",

  // GSI6: Event type + tenant + app
  GSI6PK: "EVENT#Task Processing Started",
  GSI6SK: "TENANT#gbinnovations#APP#task-workflow#TIMESTAMP#1767453739640",

  // GSI7: Event type + tenant + app + entity (narrowest)
  GSI7PK: "EVENT#Task Processing Started",
  GSI7SK: "TENANT#gbinnovations#APP#task-workflow#TASK#req-123#TIMESTAMP#1767453739640",

  // Metadata
  entityId: "req-123",
  entityType: "TASK",
  tenantId: "gbinnovations",
  eventType: "Task Processing Started",
  timestamp: 1767453739640,
  context: {
    source: "system",
    environment: "prod",
    origin: "sqs-worker",
    workerId: "worker-abc123"
  },
  properties: {
    requestId: "req-123",
    startedAt: 1767453739640,
    // ... event-specific properties
  }
}
```

### GSI Purpose Summary

| GSI | PK | SK contains | Use case |
|-----|----|----|----------|
| GSI1 | Entity (TASK#) | timestamp | All events for one task |
| GSI2 | App | timestamp | App-wide timeline |
| GSI3 | App | entity + timestamp | One task within an app |
| GSI4 | Event type | tenant + timestamp | All events of a type (tenant-wide) |
| GSI5 | Event type | tenant + entity + timestamp | Events of a type for one task |
| GSI6 | Event type | tenant + app + timestamp | Events of a type within an app |
| GSI7 | Event type | tenant + app + entity + timestamp | Narrowest: type + app + task |

### Entity Types

The entity prefix in GSI keys depends on the entity type:

| Entity Type | GSI1PK | GSI1SK | Example |
|-------------|--------|--------|---------|
| `TASK` | `TASK#{requestId}` | `TASK#TIMESTAMP#{ts}` | Task events |
| `JOB` | `JOB#{jobId}` | `JOB#TIMESTAMP#{ts}` | Job events |
| `STORE` | `STORE#{storeId}` | `STORE#TIMESTAMP#{ts}` | (other services) |

Same DynamoDB table, same GSIs — different entity prefixes.

---

## Event Properties per Type

Each event type carries specific `properties`. All events already share the common structure above (PK/SK, GSI1-7, metadata, timestamp). This section defines only the **event-specific properties** — fields unique to each event type.

Principle: minimum necessary information. If no consumer needs a field, it doesn't exist.

### Workflow-level events

#### `Task Pending`

Emitted by producer when task is enqueued to SQS. Consumers: Idempotency (state), Dispatcher (state), Health Check (lookback).

```javascript
properties: {
  requestId: "req-123",
  jobId: "job-456",           // only if part of a job, otherwise omitted
  name: "scrape-store",
  dependsOn: []               // only if part of a job, otherwise omitted
}
```

#### `Task Processing Started`

Emitted by sqs-worker when child process is spawned. Consumers: Idempotency (distributed lock), Health Check, Dispatcher.

```javascript
properties: {
  requestId: "req-123",
  jobId: "job-456",           // only if part of a job
  effectiveUntil: 1707300645, // now + VISIBILITY_EXTENSION_AMOUNT * 1.5
  workerId: "worker-i-001",   // PM2 instance identifier
  processId: 12345            // child process PID
}
```

#### `Task Processing Failed`

Emitted by sqs-worker on retryable error. Message stays in SQS for retry. Consumers: Dashboard (error history), Dispatcher (state = still processing).

```javascript
properties: {
  requestId: "req-123",
  jobId: "job-456",           // only if part of a job
  attemptNumber: 2,           // which attempt failed (1, 2, 3...)
  error: "ETIMEDOUT",         // error message
  errorCategory: "network"    // from error-classifier.js: "timeout" | "network" | "rate-limit" | "server-error"
}
```

Note: no `retryable` field — `Task Processing Failed` is retryable by definition.

#### `Task Completed`

Emitted by sqs-worker when child exits with code 0. Consumers: Dispatcher (trigger + reads output for dependent tasks), Idempotency (terminal).

```javascript
properties: {
  requestId: "req-123",
  jobId: "job-456",           // only if part of a job
  output: { ... },            // task result — passed to dependent tasks by Dispatcher
  durationMs: 45000,
  exitCode: 0,
  usage: {
    inputTokens: 12000,
    outputTokens: 3500,
    cacheReadTokens: 8000
  }
}
```

#### `Task Failed`

Emitted by sqs-worker (non-retryable error) or DLQ Lambda (retries exhausted). Terminal. Consumers: Dispatcher (trigger → Job Failure Detected), Idempotency (terminal).

```javascript
properties: {
  requestId: "req-123",
  jobId: "job-456",           // only if part of a job
  error: "Invalid API key",
  errorCategory: "auth",      // from error-classifier.js: "auth" | "validation" | "programming"
  retryCount: 3,              // how many attempts before failure
  source: "worker"            // "worker" = direct failure, "dlq" = retries exhausted
}
```

#### `Task Timeout`

Emitted by sqs-worker when it kills the child process externally. Terminal. Consumers: Dispatcher (= failed state), Idempotency (terminal).

```javascript
properties: {
  requestId: "req-123",
  jobId: "job-456",           // only if part of a job
  timeoutMs: 200000,          // CLAUDE_TIMEOUT value
  elapsedMs: 200050,          // how long child actually ran
  signal: "SIGKILL"           // "SIGTERM" (graceful) or "SIGKILL" (forced after 5s)
}
```

#### `Task Heartbeat`

Emitted by sqs-worker on each visibility extension. Consumers: Idempotency (lock refresh), Health Check (stuck detection).

```javascript
properties: {
  requestId: "req-123",
  effectiveUntil: 1707300645, // now + VISIBILITY_EXTENSION_AMOUNT * 1.5
  heartbeatNumber: 3,
  elapsedMs: 60000,
  workerId: "worker-i-001",
  processId: 12345,
  memoryUsage: { rss: 256000000 },
  lastActivity: {
    type: "step_running",     // "step_running" | "sdk_query" | "waiting"
    stepName: "color-tags",
    timestamp: 1707300540
  }
}
```

### Job-level events

#### `Job Created`

Emitted by Producer API when multi-task request is submitted. Consumers: Dispatcher (DAG source — reads full task list and dependencies), Add Tasks endpoint (reads existing DAG for validation).

```javascript
properties: {
  jobId: "job-456",
  requestId: "req-789",
  tasks: [
    { taskId: "task-A", name: "scrape-store",        dependsOn: [], input: { storeId: "store-123" } },
    { taskId: "task-B", name: "analyze-competitors",  dependsOn: [], input: { market: "fashion" } },
    { taskId: "task-C", name: "color-tags",           dependsOn: ["task-A"], input: { style: "modern" } },
    { taskId: "task-D", name: "font-pairing",         dependsOn: ["task-A"], input: {} },
    { taskId: "task-E", name: "compile-result",       dependsOn: ["task-C", "task-D"], input: {} }
  ],
  totalTasks: 5
}
```

`input`: Static input data per task. Root tasks receive this via SQS message. Dependent tasks receive their static `input` merged with `dependencyOutputs` from completed parent tasks — the Dispatcher handles this merge ([job-orchestration.md](./job-orchestration.md)).

#### `Job Tasks Added`

Emitted by Producer API when tasks are added to an existing job ([producer-api.md](./producer-api.md) §4). Consumers: Dispatcher (reads to build full DAG alongside Job Created), Add Tasks endpoint (reads existing DAG for validation).

```javascript
properties: {
  jobId: "job-456",
  newTasks: [
    { taskId: "task-F", name: "market-analysis", dependsOn: ["task-A"], input: { depth: "detailed" } }
  ],
  previousTotalTasks: 5,
  totalTasksNow: 6
}
```

#### `Job Completed`

Emitted by Dispatcher when all tasks in job are completed. Consumers: Producer (notification).

```javascript
properties: {
  jobId: "job-456",
  totalTasks: 5,
  taskStatuses: {
    "task-A": "completed",
    "task-B": "completed",
    "task-C": "completed",
    "task-D": "completed",
    "task-E": "completed"
  }
}
```

#### `Job Failure Detected`

Emitted by Dispatcher when a non-retryable task failure is detected. NOT terminal — in-progress tasks continue, job can be resumed. Consumers: Producer (notification).

```javascript
properties: {
  jobId: "job-456",
  failedTaskId: "task-C",
  taskStatuses: {
    "task-A": "completed",
    "task-B": "completed",
    "task-C": "failed",
    "task-D": "processing",
    "task-E": null
  }
}
```

### Health check events

#### `Task Health Check`

Emitted by Health Check Lambda on schedule. Consumers: Analytics/audit (Slack alerts are sent separately, not via this event).

```javascript
properties: {
  summary: {
    totalProcessing: 4,
    healthy: 2,
    warning: 1,
    critical: 0,
    overtime: 1
  },
  tasks: [
    {
      requestId: "req-123",
      health: "healthy",
      elapsed: 120000,
      timeSinceLastEvent: 15000,
      lastEventType: "Task Heartbeat",
      workerId: "worker-i-001"
    },
    {
      requestId: "req-456",
      health: "overtime",
      elapsed: 3800000,
      timeSinceLastEvent: 20000,
      lastEventType: "Task Heartbeat",
      workerId: "worker-i-002"
    }
  ]
}
```

---

## EventBridge Delivery

```javascript
await eventBridgeClient.send(new PutEventsCommand({
  Entries: [{
    EventBusName: EVENT_BUS_NAME,
    Source: `task-workflow.${appName}`,
    DetailType: 'log-event',
    Detail: JSON.stringify(event),       // complete event with all GSI keys
    Time: new Date(timestamp)
  }]
}));
```

All events use `DetailType: 'log-event'`. The Lambda consumer matches on this.

---

## Event Persistence — Single Consumer Lambda (event stack)

```
Any sender                                          DynamoDB
    │                                                  ▲
    │  Full event with all keys:                       │ PutItem
    │  PK, SK, GSI1-7, eventType,                      │ (+ receivedAt)
    │  context, properties, timestamp                  │
    ▼                                                  │
EventBridge ──→ Rule (detail-type: "log-event") ──→ save-event-to-dynamo Lambda
```

### Key Principle

**Senders compute everything.** The event arrives at EventBridge in its final form — all GSI keys, all properties, all metadata. The consumer Lambda does **one thing**: `PutItem` + add `receivedAt`.

```javascript
// save-event-to-dynamo Lambda (~15 lines)
export async function handler(event) {
  const detail = event.detail;
  const item = { ...detail, receivedAt: Date.now() };
  await ddbClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}
```

If a new event type is added, the consumer Lambda doesn't change — only the sender and reader need to know about it.

### Responsibility Split

| Concern | Who handles it |
|---------|---------------|
| GSI key computation | **Sender** (knows entity type, requestId, appName) |
| Event structure/schema | **Sender** (knows what properties to include) |
| Persistence | **Consumer Lambda** (dumb PutItem + receivedAt) |
| Querying | **Reader** (health-check, dispatcher, API, dashboard) |

---

## S3 Overflow

Events > 200KB → large fields (`outputs`, `input`, `claudeOutput`) stored in S3, EventBridge gets S3 reference:

```javascript
// Large fields replaced with:
{
  properties: {
    outputs: undefined,
    input: undefined,
    claudeOutput: undefined,
    _s3Overflow: { bucket, key: `events/${requestId}/${eventId}-payload.json` }
  }
}
```

Threshold: 200KB (safety margin from 256KB EventBridge limit).

---

## Task State Tracking

Derive task states from **existing events**. No materialized state record — pure event-sourced.

### State Machine

```
pending ──→ processing ──→ completed
                │
                └──→ failed
```

### Event-to-State Mapping

```javascript
const EVENT_TO_STATE = {
  'Task Pending':             'pending',
  'Task Processing Started':  'processing',
  'Task Processing Failed':   'processing',   // attempt failed, SQS will retry
  'Task Completed':           'completed',
  'Task Failed':              'failed',        // terminal (non-retryable or DLQ)
  'Task Timeout':             'failed',
  'Task Heartbeat':           'processing',
};
```

### Query: Single Task State

```javascript
// GSI1: Entity-scoped, latest event first
const result = await docClient.send(new QueryCommand({
  TableName: TABLE_NAME,
  IndexName: 'GSI1-index',
  KeyConditionExpression: 'GSI1PK = :pk',
  ExpressionAttributeValues: { ':pk': `TASK#${requestId}` },
  ScanIndexForward: false,
  Limit: 1
}));
const currentState = EVENT_TO_STATE[result.Items[0].eventType];
// → "pending" | "processing" | "completed" | "failed"
```

### Query: All Tasks by State

Four parallel queries + client-side set math:

```javascript
const [pending, processing, completed, failed] = await Promise.all([
  queryByEventType('Task Pending'),
  queryByEventType('Task Processing Started'),
  queryByEventType('Task Completed'),
  queryByEventType('Task Failed')
]);

async function queryByEventType(eventType) {
  // GSI4: Event type + tenant (broadest — no entity filter)
  return docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI4-index',
    KeyConditionExpression: 'GSI4PK = :pk AND begins_with(GSI4SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `EVENT#${eventType}`,
      ':sk': `TENANT#${tenantId}#TIMESTAMP#`
    }
  }));
}

// Set subtraction for CURRENT state
const completedIds  = new Set(completed.map(e => e.properties.requestId));
const failedIds     = new Set(failed.map(e => e.properties.requestId));
const processingIds = new Set(processing.map(e => e.properties.requestId));
const pendingIds    = new Set(pending.map(e => e.properties.requestId));

const currentlyPending    = difference(pendingIds, processingIds);
const currentlyProcessing = difference(processingIds, completedIds, failedIds);
const currentlyFailed     = difference(failedIds, processingIds);  // failed and not retried
const currentlyCompleted  = completedIds;

function difference(setA, ...others) {
  const result = new Set(setA);
  for (const setB of others) {
    for (const item of setB) result.delete(item);
  }
  return result;
}
```

### Query: Task History

```javascript
// GSI1: All events for this task, chronological
const result = await docClient.send(new QueryCommand({
  TableName: TABLE_NAME,
  IndexName: 'GSI1-index',
  KeyConditionExpression: 'GSI1PK = :pk',
  ExpressionAttributeValues: { ':pk': `TASK#${requestId}` },
  ScanIndexForward: true
}));
// Returns: Task Pending → Task Processing Started → Task Heartbeat → ... → Task Completed
```

### Query: Job Tasks

```javascript
// All events for a job
// GSI1PK = "JOB#job-456"
const jobEvents = await docClient.send(new QueryCommand({
  TableName: TABLE_NAME,
  IndexName: 'GSI1-index',
  KeyConditionExpression: 'GSI1PK = :pk',
  ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
  ScanIndexForward: true
}));

// Status of each task in the job (from Job Created event → task list)
const jobDag = jobEvents.Items[0].properties.tasks;
for (const task of jobDag) {
  // GSI1: latest event per taskId
  const latest = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${task.taskId}` },
    ScanIndexForward: false,
    Limit: 1
  }));
}
```

---

## DynamoDB Table Schema

PAY_PER_REQUEST, 7 GSIs (all ProjectionType: ALL), TTL on `ttl` attribute.

```yaml
EventsTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: events-${stage}
    BillingMode: PAY_PER_REQUEST
    AttributeDefinitions:
      - { AttributeName: PK,     AttributeType: S }
      - { AttributeName: SK,     AttributeType: S }
      - { AttributeName: GSI1PK, AttributeType: S }
      - { AttributeName: GSI1SK, AttributeType: S }
      - { AttributeName: GSI2PK, AttributeType: S }
      - { AttributeName: GSI2SK, AttributeType: S }
      - { AttributeName: GSI3PK, AttributeType: S }
      - { AttributeName: GSI3SK, AttributeType: S }
      - { AttributeName: GSI4PK, AttributeType: S }
      - { AttributeName: GSI4SK, AttributeType: S }
      - { AttributeName: GSI5PK, AttributeType: S }
      - { AttributeName: GSI5SK, AttributeType: S }
      - { AttributeName: GSI6PK, AttributeType: S }
      - { AttributeName: GSI6SK, AttributeType: S }
      - { AttributeName: GSI7PK, AttributeType: S }
      - { AttributeName: GSI7SK, AttributeType: S }
    KeySchema:
      - { AttributeName: PK, KeyType: HASH }
      - { AttributeName: SK, KeyType: RANGE }
    GlobalSecondaryIndexes:
      - IndexName: GSI1-index
        KeySchema:
          - { AttributeName: GSI1PK, KeyType: HASH }
          - { AttributeName: GSI1SK, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
      - IndexName: GSI2-index
        KeySchema:
          - { AttributeName: GSI2PK, KeyType: HASH }
          - { AttributeName: GSI2SK, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
      - IndexName: GSI3-index
        KeySchema:
          - { AttributeName: GSI3PK, KeyType: HASH }
          - { AttributeName: GSI3SK, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
      - IndexName: GSI4-index
        KeySchema:
          - { AttributeName: GSI4PK, KeyType: HASH }
          - { AttributeName: GSI4SK, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
      - IndexName: GSI5-index
        KeySchema:
          - { AttributeName: GSI5PK, KeyType: HASH }
          - { AttributeName: GSI5SK, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
      - IndexName: GSI6-index
        KeySchema:
          - { AttributeName: GSI6PK, KeyType: HASH }
          - { AttributeName: GSI6SK, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
      - IndexName: GSI7-index
        KeySchema:
          - { AttributeName: GSI7PK, KeyType: HASH }
          - { AttributeName: GSI7SK, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
    TimeToLiveSpecification:
      AttributeName: ttl
      Enabled: true
```

---

## EventBridge Rule + Lambda Permission

```yaml
SaveEventToDynamoRule:
  Type: AWS::Events::Rule
  Properties:
    Name: ${stage}-save-event-to-dynamo
    EventBusName: !Ref EventBus
    EventPattern:
      detail-type:
        - "log-event"
    Targets:
      - Arn: !GetAtt SaveEventToDynamoFunction.Arn
        Id: ${stage}-SaveEventToDynamo
        DeadLetterConfig:
          Arn: !GetAtt EventBridgeTargetDLQ.Arn
        RetryPolicy:
          MaximumRetryAttempts: 3
          MaximumEventAgeInSeconds: 3600

EventBridgeTargetDLQ:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: ${stage}-eventbridge-target-dlq
    MessageRetentionPeriod: 1209600  # 14 days

EventBridgeTargetDLQPolicy:
  Type: AWS::SQS::QueuePolicy
  Properties:
    Queues:
      - !Ref EventBridgeTargetDLQ
    PolicyDocument:
      Statement:
        - Effect: Allow
          Principal:
            Service: events.amazonaws.com
          Action: sqs:SendMessage
          Resource: !GetAtt EventBridgeTargetDLQ.Arn

SaveEventToDynamoPermission:
  Type: AWS::Lambda::Permission
  Properties:
    FunctionName: !Ref SaveEventToDynamoFunction
    Action: lambda:InvokeFunction
    Principal: events.amazonaws.com
    SourceArn: !GetAtt SaveEventToDynamoRule.Arn
```

---

## EventBridge Target DLQ — Slack Alert Lambda (event stack)

When EventBridge fails to deliver an event to a target Lambda (after 3 retries), the event lands in `EventBridgeTargetDLQ`. A Lambda consumes this DLQ and sends a Slack alert.

This catches failures in **any** EventBridge target — `save-event-to-dynamo`, Dispatcher Lambda, etc. If an event lands here, something went very wrong (Lambda down, throttled, or crashing).

```yaml
# serverless.yml — event stack
eventbridge-dlq-alert:
  handler: src/eventbridge-dlq-alert.handler
  description: Alerts Slack when EventBridge fails to deliver events
  timeout: 30
  memorySize: 256
  environment:
    SLACK_WEBHOOK_URL: ${ssm:/brief/${self:provider.stage}/slack-webhook-url}
  events:
    - sqs:
        arn: !GetAtt EventBridgeTargetDLQ.Arn
        batchSize: 1
```

```javascript
// src/eventbridge-dlq-alert.js
export async function handler(event) {
  for (const record of event.Records) {
    const failedEvent = JSON.parse(record.body);

    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: [
          ':rotating_light: *EventBridge delivery failure*',
          `*Event type:* ${failedEvent.detail?.eventType || 'unknown'}`,
          `*Detail type:* ${failedEvent['detail-type'] || 'unknown'}`,
          `*Task:* ${failedEvent.detail?.GSI1PK || 'unknown'}`,
          `*Time:* ${failedEvent.time || 'unknown'}`,
          `*Message ID:* ${record.messageId}`,
        ].join('\n'),
      }),
    });
  }
}
```
