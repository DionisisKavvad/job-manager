# Producer API

API Gateway (REST) with Lambda proxy integration. Entry point for creating jobs, adding tasks, and querying job status.

Authentication: API Key (`x-api-key` header) via API Gateway Usage Plan.

Related docs: [consumer-architecture.md](./consumer-architecture.md), [event-system.md](./event-system.md), [job-orchestration.md](./job-orchestration.md)

---

## 1. Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/jobs` | Create new job with task DAG | API Key |
| `POST` | `/jobs/{jobId}/tasks` | Add tasks to existing job | API Key |
| `GET` | `/jobs` | List all jobs with status | API Key |
| `GET` | `/jobs/{jobId}` | Get job details with task statuses | API Key |

---

## 2. Authentication

Single API Key for all endpoints. API Gateway validates the key before the request reaches the Lambda.

```yaml
# Serverless Framework — API Key + Usage Plan
provider:
  apiGateway:
    apiKeys:
      - name: producer-api-key-${self:provider.stage}
    usagePlan:
      quota:
        limit: 10000
        period: DAY
      throttle:
        burstLimit: 50
        rateLimit: 100
```

Each endpoint uses `private: true` → API Gateway requires `x-api-key` header.

```bash
curl -X POST https://xxx.execute-api.eu-west-1.amazonaws.com/dev/jobs \
  -H "x-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{ "tasks": [...] }'
```

**Future**: Migrate to JWT or IAM auth when multi-tenant support is needed.

---

## 3. POST /jobs — Create Job

Creates a new job with a DAG of tasks. Validates the DAG, emits events, enqueues root tasks to SQS.

### Request

```json
POST /jobs

{
  "tasks": [
    {
      "taskId": "scrape-store",
      "name": "scrape-store",
      "dependsOn": [],
      "input": { "storeId": "store-123", "url": "https://example.com" }
    },
    {
      "taskId": "analyze-competitors",
      "name": "analyze-competitors",
      "dependsOn": [],
      "input": { "market": "fashion" }
    },
    {
      "taskId": "color-tags",
      "name": "color-tags",
      "dependsOn": ["scrape-store"],
      "input": { "style": "modern" }
    },
    {
      "taskId": "font-pairing",
      "name": "font-pairing",
      "dependsOn": ["scrape-store"],
      "input": {}
    },
    {
      "taskId": "compile-result",
      "name": "compile-result",
      "dependsOn": ["color-tags", "font-pairing"],
      "input": {}
    }
  ]
}
```

### Task Fields

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | Yes | Unique within job. Format: `/^[a-zA-Z0-9-_]{1,128}$/` |
| `name` | Yes | Task type name — maps to a known task definition on the consumer |
| `dependsOn` | No | Array of taskIds this task waits for. Default: `[]` |
| `input` | No | Static input data for this task. Default: `{}` |

**Input handling**: Root tasks (no dependencies) receive their `input` directly via SQS message. Dependent tasks receive their static `input` merged with `dependencyOutputs` from completed parent tasks — the Dispatcher handles this merge ([job-orchestration.md](./job-orchestration.md)).

### Validation

```
1. tasks array: required, non-empty, max 50 tasks
2. Each task:
   a. taskId: required, unique within job, matches /^[a-zA-Z0-9-_]{1,128}$/
   b. name: required, non-empty string
   c. dependsOn: all references must exist in the tasks array
3. DAG validation:
   a. Graph is acyclic (topological sort succeeds)
   b. At least one root task (empty dependsOn)
```

### Flow

```
Client
  │
  │  POST /jobs { tasks: [...] }
  ▼
API Gateway (validates API key)
  │
  ▼
create-job Lambda
  │
  ├── 1. Validate request body + DAG (topological sort)
  │
  ├── 2. Generate jobId (UUID v4)
  │
  ├── 3. Emit "Job Created" event → EventBridge
  │      (full task DAG with inputs, all GSI keys)
  │
  ├── 4. For each root task (dependsOn = []):
  │      ├── SendMessage → SQS (taskId, jobId, name, input)
  │      └── Emit "Task Pending" event → EventBridge
  │
  └── 5. Return 201 { jobId, status, rootTasks }
```

### Handler

```javascript
// src/handlers/create-job.js

import { randomUUID } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { validateDag } from '../lib/dag-validator.js';
import { buildEvent } from '../lib/event-builder.js';
import { success, error } from '../lib/response.js';

const sqsClient = new SQSClient({});
const ebClient = new EventBridgeClient({});

export async function handler(event) {
  const body = JSON.parse(event.body);

  // 1. Validate
  const validation = validateDag(body.tasks);
  if (!validation.valid) {
    return error(400, validation.errors);
  }

  const jobId = `job-${randomUUID()}`;
  const now = Date.now();
  const tasks = body.tasks;
  const rootTasks = tasks.filter(t => !t.dependsOn || t.dependsOn.length === 0);

  // 2. Emit "Job Created" event
  const jobCreatedEvent = buildEvent('Job Created', {
    entityId: jobId,
    entityType: 'JOB',
    properties: {
      jobId,
      tasks: tasks.map(t => ({
        taskId: t.taskId,
        name: t.name,
        dependsOn: t.dependsOn || [],
        input: t.input || {}
      })),
      totalTasks: tasks.length
    }
  });

  await ebClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: process.env.EVENT_BUS_NAME,
      Source: `task-workflow.${process.env.APP_NAME}`,
      DetailType: 'log-event',
      Detail: JSON.stringify(jobCreatedEvent),
      Time: new Date(now)
    }]
  }));

  // 3. Enqueue root tasks + emit Task Pending
  for (const task of rootTasks) {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.TASK_QUEUE_URL,
      MessageBody: JSON.stringify({
        taskId: task.taskId,
        jobId,
        name: task.name,
        input: task.input || {}
      }),
      MessageAttributes: {
        requestId: { DataType: 'String', StringValue: task.taskId }
      }
    }));

    const taskPendingEvent = buildEvent('Task Pending', {
      entityId: task.taskId,
      entityType: 'TASK',
      properties: {
        requestId: task.taskId,
        jobId,
        name: task.name,
        dependsOn: []
      }
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: `task-workflow.${process.env.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(taskPendingEvent),
        Time: new Date(now)
      }]
    }));
  }

  // 4. Response
  return success(201, {
    jobId,
    status: 'created',
    totalTasks: tasks.length,
    rootTasks: rootTasks.map(t => t.taskId),
    createdAt: now
  });
}
```

### Response — 201 Created

```json
{
  "jobId": "job-a1b2c3d4-...",
  "status": "created",
  "totalTasks": 5,
  "rootTasks": ["scrape-store", "analyze-competitors"],
  "createdAt": 1707300000000
}
```

### Errors

| Status | When | Example |
|--------|------|---------|
| 400 | Validation failed | `{ "error": "Cycle detected: color-tags → scrape-store → color-tags" }` |
| 400 | Invalid taskId format | `{ "error": "taskId 'my task!' does not match /^[a-zA-Z0-9-_]{1,128}$/" }` |
| 400 | Duplicate taskId | `{ "error": "Duplicate taskId: scrape-store" }` |
| 400 | Missing dependency ref | `{ "error": "Task color-tags depends on unknown-task which does not exist" }` |
| 401 | Missing/invalid API key | Handled by API Gateway (never reaches Lambda) |
| 500 | SQS/EventBridge failure | `{ "error": "Internal server error" }` |

---

## 4. POST /jobs/{jobId}/tasks — Add Tasks

Adds tasks to an existing job. New tasks can depend on existing tasks (already in the job) and on other new tasks in the same request.

### Request

```json
POST /jobs/job-a1b2c3d4/tasks

{
  "tasks": [
    {
      "taskId": "extra-analysis",
      "name": "market-analysis",
      "dependsOn": ["scrape-store"],
      "input": { "depth": "detailed" }
    },
    {
      "taskId": "final-report",
      "name": "compile-report",
      "dependsOn": ["extra-analysis", "compile-result"],
      "input": {}
    }
  ]
}
```

### Validation

```
1. jobId: must match an existing "Job Created" event in DynamoDB
2. New tasks:
   a. taskId: unique within new tasks AND not already in the existing job
   b. dependsOn: can reference existing tasks OR other new tasks
   c. Combined DAG (existing + new) must remain acyclic
3. Job not in terminal state (Job Completed)
```

### Flow

```
Client
  │
  │  POST /jobs/{jobId}/tasks { tasks: [...] }
  ▼
API Gateway (validates API key)
  │
  ▼
add-tasks Lambda
  │
  ├── 1. Read "Job Created" event from DynamoDB (GSI1: JOB#{jobId})
  │      Also read any existing "Job Tasks Added" events
  │
  ├── 2. Build full current DAG (original + previously added tasks)
  │
  ├── 3. Validate new tasks against full DAG
  │      (unique IDs, valid deps, combined graph acyclic)
  │
  ├── 4. Emit "Job Tasks Added" event → EventBridge
  │
  ├── 5. Check which new tasks are immediately ready:
  │      For each new task, check if ALL dependencies are already completed
  │      (Query GSI1 for latest event of each dependency)
  │
  ├── 6. For each immediately ready task:
  │      ├── SendMessage → SQS
  │      └── Emit "Task Pending" event → EventBridge
  │
  └── 7. Return 200 { jobId, addedTasks, readyTasks, newTotal }
```

### Handler

```javascript
// src/handlers/add-tasks.js

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { validateDag } from '../lib/dag-validator.js';
import { getJobDag, getLatestTaskEvent } from '../lib/job-queries.js';
import { buildEvent } from '../lib/event-builder.js';
import { success, error } from '../lib/response.js';

const EVENT_TO_STATE = {
  'Task Pending':             'pending',
  'Task Processing Started':  'processing',
  'Task Processing Failed':   'processing',
  'Task Completed':           'completed',
  'Task Failed':              'failed',
  'Task Timeout':             'failed',
  'Task Heartbeat':           'processing',
};

const sqsClient = new SQSClient({});
const ebClient = new EventBridgeClient({});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  const jobId = event.pathParameters.jobId;
  const body = JSON.parse(event.body);
  const newTasks = body.tasks;
  const now = Date.now();

  // 1. Get existing job DAG
  const existingDag = await getJobDag(ddbClient, jobId);
  if (!existingDag) {
    return error(404, { error: 'Job not found' });
  }

  // 2. Check job not completed
  const jobEvents = await getJobEvents(ddbClient, jobId);
  const isCompleted = jobEvents.some(e => e.eventType === 'Job Completed');
  if (isCompleted) {
    return error(409, { error: 'Job already completed — cannot add tasks' });
  }

  // 3. Validate combined DAG
  const combinedTasks = [...existingDag.tasks, ...newTasks];
  const validation = validateDag(combinedTasks, {
    existingIds: new Set(existingDag.tasks.map(t => t.taskId))
  });
  if (!validation.valid) {
    return error(400, validation.errors);
  }

  // 4. Emit "Job Tasks Added" event
  const jobTasksAddedEvent = buildEvent('Job Tasks Added', {
    entityId: jobId,
    entityType: 'JOB',
    properties: {
      jobId,
      newTasks: newTasks.map(t => ({
        taskId: t.taskId,
        name: t.name,
        dependsOn: t.dependsOn || [],
        input: t.input || {}
      })),
      previousTotalTasks: existingDag.tasks.length,
      totalTasksNow: combinedTasks.length
    }
  });

  await ebClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: process.env.EVENT_BUS_NAME,
      Source: `task-workflow.${process.env.APP_NAME}`,
      DetailType: 'log-event',
      Detail: JSON.stringify(jobTasksAddedEvent),
      Time: new Date(now)
    }]
  }));

  // 5. Check which new tasks are immediately ready
  const readyTasks = [];

  for (const task of newTasks) {
    const deps = task.dependsOn || [];
    if (deps.length === 0) {
      readyTasks.push(task);
      continue;
    }

    // All deps must reference existing (not new) tasks AND be completed
    const allDepsCompleted = await Promise.all(
      deps.map(async depId => {
        // Skip deps that are new tasks (can't be completed yet)
        if (newTasks.some(t => t.taskId === depId)) return false;

        const latestEvent = await getLatestTaskEvent(ddbClient, depId);
        return latestEvent && EVENT_TO_STATE[latestEvent.eventType] === 'completed';
      })
    );

    if (allDepsCompleted.every(Boolean)) {
      readyTasks.push(task);
    }
  }

  // 6. Enqueue ready tasks
  for (const task of readyTasks) {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.TASK_QUEUE_URL,
      MessageBody: JSON.stringify({
        taskId: task.taskId,
        jobId,
        name: task.name,
        input: task.input || {}
      }),
      MessageAttributes: {
        requestId: { DataType: 'String', StringValue: task.taskId }
      }
    }));

    const taskPendingEvent = buildEvent('Task Pending', {
      entityId: task.taskId,
      entityType: 'TASK',
      properties: {
        requestId: task.taskId,
        jobId,
        name: task.name,
        dependsOn: task.dependsOn || []
      }
    });

    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: `task-workflow.${process.env.APP_NAME}`,
        DetailType: 'log-event',
        Detail: JSON.stringify(taskPendingEvent),
        Time: new Date(now)
      }]
    }));
  }

  return success(200, {
    jobId,
    addedTasks: newTasks.map(t => t.taskId),
    immediatelyReady: readyTasks.map(t => t.taskId),
    totalTasksNow: combinedTasks.length
  });
}
```

### Response — 200 OK

```json
{
  "jobId": "job-a1b2c3d4-...",
  "addedTasks": ["extra-analysis", "final-report"],
  "immediatelyReady": ["extra-analysis"],
  "totalTasksNow": 7
}
```

### Errors

| Status | When |
|--------|------|
| 400 | Validation failed (duplicate ID, cycle, bad ref) |
| 401 | Missing/invalid API key |
| 404 | Job not found |
| 409 | Job already completed |
| 500 | Internal error |

### Eventual Consistency Note

Events flow through EventBridge → Lambda → DynamoDB. There is a small window (~100-500ms) between event emission and DynamoDB persistence. If `POST /jobs` is immediately followed by `POST /jobs/{jobId}/tasks`, the Job Created event may not be queryable yet.

Mitigation: the add-tasks Lambda returns 404 if the job is not found. The client should retry with backoff (e.g. 1s delay).

---

## 5. GET /jobs — List Jobs

Returns all jobs with their current status. Uses parallel GSI4 queries + set math (same pattern as task state tracking in [event-system.md](./event-system.md)).

### Query Pattern

```javascript
// Three parallel queries — same approach as "All Tasks by State" in event-system.md
const [created, completed, failureDetected] = await Promise.all([
  queryByEventType('Job Created'),
  queryByEventType('Job Completed'),
  queryByEventType('Job Failure Detected')
]);

async function queryByEventType(eventType) {
  return ddbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI4-index',
    KeyConditionExpression: 'GSI4PK = :pk AND begins_with(GSI4SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `EVENT#${eventType}`,
      ':sk': `TENANT#${TENANT_ID}#TIMESTAMP#`
    },
    ScanIndexForward: false     // newest first
  }));
}

// Derive current status per job
const completedJobIds = new Set(completed.map(e => e.properties.jobId));
const failedJobIds    = new Set(failureDetected.map(e => e.properties.jobId));

const jobs = created.map(event => {
  const jobId = event.properties.jobId;
  let status = 'processing';
  if (completedJobIds.has(jobId))  status = 'completed';
  else if (failedJobIds.has(jobId)) status = 'partial_failure';

  return {
    jobId,
    status,
    totalTasks: event.properties.totalTasks,
    createdAt: event.timestamp
  };
});
```

### Pagination

Cursor-based using DynamoDB `LastEvaluatedKey`:

```
GET /jobs?limit=20
GET /jobs?limit=20&cursor=eyJHU0k0UEsiOi...
```

The cursor is a Base64-encoded `LastEvaluatedKey` from the Job Created query. The other two queries (completed, failed) return small sets (just jobIds) — no pagination needed for those.

### Query Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | `20` | Max jobs per page (1–100) |
| `cursor` | — | Pagination cursor from previous response |
| `status` | — | Filter: `processing`, `completed`, `partial_failure` |

### Handler

```javascript
// src/handlers/list-jobs.js

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { success, error } from '../lib/response.js';
import { config } from '../config.js';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  const params = event.queryStringParameters || {};
  const limit = Math.min(Math.max(parseInt(params.limit) || 20, 1), 100);
  const cursor = params.cursor
    ? JSON.parse(Buffer.from(params.cursor, 'base64url').toString())
    : undefined;
  const statusFilter = params.status || null;

  // 1. Three parallel queries
  const [createdResult, completedResult, failureResult] = await Promise.all([
    queryEventType('Job Created', { limit, cursor }),
    queryEventType('Job Completed'),
    queryEventType('Job Failure Detected')
  ]);

  const completedJobIds = new Set(
    completedResult.Items.map(e => e.properties.jobId)
  );
  const failedJobIds = new Set(
    failureResult.Items.map(e => e.properties.jobId)
  );

  // 2. Build job list
  let jobs = createdResult.Items.map(event => {
    const jobId = event.properties.jobId;
    let status = 'processing';
    if (completedJobIds.has(jobId))  status = 'completed';
    else if (failedJobIds.has(jobId)) status = 'partial_failure';

    return {
      jobId,
      status,
      totalTasks: event.properties.totalTasks,
      createdAt: event.timestamp
    };
  });

  // 3. Filter by status if requested
  if (statusFilter) {
    jobs = jobs.filter(j => j.status === statusFilter);
  }

  // 4. Pagination cursor
  const nextCursor = createdResult.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(createdResult.LastEvaluatedKey)).toString('base64url')
    : null;

  return success(200, { jobs, nextCursor });
}

async function queryEventType(eventType, options = {}) {
  const params = {
    TableName: config.TABLE_NAME,
    IndexName: 'GSI4-index',
    KeyConditionExpression: 'GSI4PK = :pk AND begins_with(GSI4SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `EVENT#${eventType}`,
      ':sk': `TENANT#${config.TENANT_ID}#TIMESTAMP#`
    },
    ScanIndexForward: false
  };

  if (options.limit)  params.Limit = options.limit;
  if (options.cursor) params.ExclusiveStartKey = options.cursor;

  return ddbClient.send(new QueryCommand(params));
}
```

### Response — 200 OK

```json
{
  "jobs": [
    {
      "jobId": "job-a1b2c3d4-...",
      "status": "processing",
      "totalTasks": 5,
      "createdAt": 1707300000000
    },
    {
      "jobId": "job-e5f6g7h8-...",
      "status": "completed",
      "totalTasks": 3,
      "createdAt": 1707200000000
    }
  ],
  "nextCursor": "eyJHU0k0UEsiOiJFVkVOVC..."
}
```

---

## 6. GET /jobs/{jobId} — Job Details

Returns full job details including per-task statuses.

### Query Pattern

```
1. Query GSI1: JOB#{jobId} → all job-level events
   → Job Created, Job Tasks Added, Job Completed, Job Failure Detected

2. From Job Created + Job Tasks Added → build full task list

3. For each task, Query GSI1: TASK#{taskId} → latest event (Limit: 1)
   → Derive current state via EVENT_TO_STATE mapping
```

### Handler

```javascript
// src/handlers/get-job.js

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { success, error } from '../lib/response.js';
import { config } from '../config.js';

const EVENT_TO_STATE = {
  'Task Pending':             'pending',
  'Task Processing Started':  'processing',
  'Task Processing Failed':   'processing',
  'Task Completed':           'completed',
  'Task Failed':              'failed',
  'Task Timeout':             'failed',
  'Task Heartbeat':           'processing',
};

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  const jobId = event.pathParameters.jobId;

  // 1. Get all job-level events
  const jobEventsResult = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
    ScanIndexForward: true
  }));

  const jobEvents = jobEventsResult.Items || [];
  if (jobEvents.length === 0) {
    return error(404, { error: 'Job not found' });
  }

  // 2. Build full task list from Job Created + Job Tasks Added
  const jobCreated = jobEvents.find(e => e.eventType === 'Job Created');
  const tasksAdded = jobEvents.filter(e => e.eventType === 'Job Tasks Added');

  let allTasks = [...jobCreated.properties.tasks];
  for (const addedEvent of tasksAdded) {
    allTasks = [...allTasks, ...addedEvent.properties.newTasks];
  }

  // 3. Job-level status
  const jobCompleted = jobEvents.find(e => e.eventType === 'Job Completed');
  const jobFailure   = jobEvents.find(e => e.eventType === 'Job Failure Detected');

  let jobStatus = 'processing';
  if (jobCompleted)  jobStatus = 'completed';
  else if (jobFailure) jobStatus = 'partial_failure';

  // 4. Per-task status
  const tasks = await Promise.all(allTasks.map(async task => {
    const latestResult = await ddbClient.send(new QueryCommand({
      TableName: config.TABLE_NAME,
      IndexName: 'GSI1-index',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `TASK#${task.taskId}` },
      ScanIndexForward: false,
      Limit: 1
    }));

    const latestEvent = latestResult.Items?.[0];
    const state = latestEvent ? EVENT_TO_STATE[latestEvent.eventType] : null;

    return {
      taskId: task.taskId,
      name: task.name,
      dependsOn: task.dependsOn,
      status: state || 'waiting',         // null = not yet dispatched
      lastEventType: latestEvent?.eventType || null,
      lastEventAt: latestEvent?.timestamp || null
    };
  }));

  // 5. Progress summary
  const statusCounts = { waiting: 0, pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const task of tasks) {
    statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
  }

  return success(200, {
    jobId,
    status: jobStatus,
    totalTasks: allTasks.length,
    progress: statusCounts,
    createdAt: jobCreated.timestamp,
    completedAt: jobCompleted?.timestamp || null,
    tasks
  });
}
```

### Response — 200 OK

```json
{
  "jobId": "job-a1b2c3d4-...",
  "status": "processing",
  "totalTasks": 5,
  "progress": {
    "waiting": 1,
    "pending": 0,
    "processing": 1,
    "completed": 3,
    "failed": 0
  },
  "createdAt": 1707300000000,
  "completedAt": null,
  "tasks": [
    {
      "taskId": "scrape-store",
      "name": "scrape-store",
      "dependsOn": [],
      "status": "completed",
      "lastEventType": "Task Completed",
      "lastEventAt": 1707300045000
    },
    {
      "taskId": "compile-result",
      "name": "compile-result",
      "dependsOn": ["color-tags", "font-pairing"],
      "status": "waiting",
      "lastEventType": null,
      "lastEventAt": null
    }
  ]
}
```

---

## 7. DAG Validation

Topological sort (Kahn's algorithm) validates the task DAG before job creation or task addition.

```javascript
// src/lib/dag-validator.js

const TASK_ID_PATTERN = /^[a-zA-Z0-9-_]{1,128}$/;

/**
 * @param {Array} tasks - All tasks (existing + new for add-tasks)
 * @param {Object} options
 * @param {Set} options.existingIds - IDs already in the job (for add-tasks validation)
 * @returns {{ valid: boolean, errors: string[], order: string[] }}
 */
export function validateDag(tasks, options = {}) {
  const errors = [];
  const existingIds = options.existingIds || new Set();

  // 1. Basic field validation
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { valid: false, errors: ['tasks must be a non-empty array'] };
  }

  if (tasks.length > 50) {
    return { valid: false, errors: [`Too many tasks: ${tasks.length} (max 50)`] };
  }

  const taskIds = new Set();
  for (const task of tasks) {
    if (!task.taskId || !TASK_ID_PATTERN.test(task.taskId)) {
      errors.push(`Invalid taskId: "${task.taskId}" — must match ${TASK_ID_PATTERN}`);
      continue;
    }
    if (taskIds.has(task.taskId) || existingIds.has(task.taskId)) {
      errors.push(`Duplicate taskId: ${task.taskId}`);
    }
    taskIds.add(task.taskId);

    if (!task.name || typeof task.name !== 'string') {
      errors.push(`Task ${task.taskId}: name is required`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 2. Dependency reference validation
  const allKnownIds = new Set([...taskIds, ...existingIds]);

  for (const task of tasks) {
    for (const depId of (task.dependsOn || [])) {
      if (!allKnownIds.has(depId)) {
        errors.push(`Task ${task.taskId} depends on "${depId}" which does not exist`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 3. Cycle detection — Kahn's algorithm (topological sort)
  const inDegree = {};
  const adjacency = {};

  for (const task of tasks) {
    inDegree[task.taskId] = 0;
    adjacency[task.taskId] = [];
  }

  for (const task of tasks) {
    for (const depId of (task.dependsOn || [])) {
      // Only count edges within the current task set (not existing tasks)
      if (taskIds.has(depId)) {
        adjacency[depId].push(task.taskId);
        inDegree[task.taskId]++;
      }
    }
  }

  // Start with tasks that have no in-degree from other NEW tasks
  // (deps on existing tasks don't count — they're already resolved)
  const queue = [];
  for (const task of tasks) {
    if (inDegree[task.taskId] === 0) {
      queue.push(task.taskId);
    }
  }

  const order = [];
  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);

    for (const neighbor of adjacency[current]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (order.length !== tasks.length) {
    const inCycle = tasks
      .filter(t => !order.includes(t.taskId))
      .map(t => t.taskId);
    errors.push(`Cycle detected involving: ${inCycle.join(', ')}`);
    return { valid: false, errors };
  }

  // 4. At least one root task (no dependencies)
  const hasRoot = tasks.some(t => !t.dependsOn || t.dependsOn.length === 0);
  if (!hasRoot && existingIds.size === 0) {
    errors.push('At least one root task (empty dependsOn) is required');
    return { valid: false, errors };
  }

  return { valid: true, errors: [], order };
}
```

---

## 8. Shared Utilities

### Event Builder

Computes all GSI keys — single source of truth for event structure (same as [event-system.md](./event-system.md) Event Structure).

```javascript
// src/lib/event-builder.js

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export function buildEvent(eventType, { entityId, entityType, properties }) {
  const timestamp = Date.now();
  const eventId = randomUUID();

  return {
    PK:     `TENANT#${config.TENANT_ID}`,
    SK:     `TIMESTAMP#${timestamp}#EVENT#${eventId}`,

    GSI1PK: `${entityType}#${entityId}`,
    GSI1SK: `${entityType}#TIMESTAMP#${timestamp}`,

    GSI2PK: `APP#${config.APP_NAME}`,
    GSI2SK: `TIMESTAMP#${timestamp}`,

    GSI3PK: `APP#${config.APP_NAME}`,
    GSI3SK: `${entityType}#${entityId}#TIMESTAMP#${timestamp}`,

    GSI4PK: `EVENT#${eventType}`,
    GSI4SK: `TENANT#${config.TENANT_ID}#TIMESTAMP#${timestamp}`,

    GSI5PK: `EVENT#${eventType}`,
    GSI5SK: `TENANT#${config.TENANT_ID}#${entityType}#${entityId}#TIMESTAMP#${timestamp}`,

    GSI6PK: `EVENT#${eventType}`,
    GSI6SK: `TENANT#${config.TENANT_ID}#APP#${config.APP_NAME}#TIMESTAMP#${timestamp}`,

    GSI7PK: `EVENT#${eventType}`,
    GSI7SK: `TENANT#${config.TENANT_ID}#APP#${config.APP_NAME}#${entityType}#${entityId}#TIMESTAMP#${timestamp}`,

    entityId,
    entityType,
    tenantId: config.TENANT_ID,
    eventType,
    timestamp,
    context: {
      source: 'system',
      environment: process.env.ENVIRONMENT || 'dev',
      origin: 'producer-api'
    },
    properties
  };
}
```

### Job Queries

```javascript
// src/lib/job-queries.js

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config.js';

export async function getJobDag(ddbClient, jobId) {
  // Get Job Created event
  const jobCreated = await getJobEvent(ddbClient, jobId, 'Job Created');
  if (!jobCreated) return null;

  // Get all Job Tasks Added events
  const allJobEvents = await getAllJobEvents(ddbClient, jobId);
  const tasksAdded = allJobEvents.filter(e => e.eventType === 'Job Tasks Added');

  let tasks = [...jobCreated.properties.tasks];
  for (const added of tasksAdded) {
    tasks = [...tasks, ...added.properties.newTasks];
  }

  return { jobId, tasks, totalTasks: tasks.length };
}

export async function getAllJobEvents(ddbClient, jobId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
    ScanIndexForward: true
  }));
  return result.Items || [];
}

export async function getLatestTaskEvent(ddbClient, taskId) {
  const result = await ddbClient.send(new QueryCommand({
    TableName: config.TABLE_NAME,
    IndexName: 'GSI1-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    ScanIndexForward: false,
    Limit: 1
  }));
  return result.Items?.[0] || null;
}

async function getJobEvent(ddbClient, jobId, eventType) {
  const events = await getAllJobEvents(ddbClient, jobId);
  return events.find(e => e.eventType === eventType) || null;
}
```

### Response Helpers

```javascript
// src/lib/response.js

export function success(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}

export function error(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}
```

### Config

```javascript
// src/config.js

export const config = {
  TABLE_NAME:  process.env.EVENTS_TABLE,
  TENANT_ID:   process.env.TENANT_ID || 'gbInnovations',
  APP_NAME:    process.env.APP_NAME  || 'task-workflow',
};
```

---

## 9. Serverless Configuration

```yaml
service: producer-api

build:
  esbuild: true

custom:
  resources: ${file(../../../config/config.${self:provider.stage}.yml)}

provider:
  name: aws
  runtime: nodejs22.x
  stage: ${opt:stage, 'dev'}
  region: ${opt:region, 'eu-west-1'}
  profile: ${self:custom.resources.profile, 'default'}
  stackTags:
    Team: producer-api-${self:provider.stage}
  environment:
    ENVIRONMENT: ${self:provider.stage}
    SERVICE_NAME: ${self:service}
    EVENTS_TABLE: !ImportValue events-table-name-${self:provider.stage}
    TASK_QUEUE_URL: !ImportValue task-queue-queue-url-${self:provider.stage}
    EVENT_BUS_NAME: !ImportValue event-bus-name-${self:provider.stage}
    TENANT_ID: gbInnovations
    APP_NAME: task-workflow
  apiGateway:
    apiKeys:
      - name: producer-api-key-${self:provider.stage}
    usagePlan:
      quota:
        limit: 10000
        period: DAY
      throttle:
        burstLimit: 50
        rateLimit: 100

functions:
  create-job:
    handler: src/handlers/create-job.handler
    description: Creates a new job with task DAG
    timeout: 30
    memorySize: 256
    events:
      - http:
          path: /jobs
          method: post
          private: true
    iamRoleStatements:
      - Effect: Allow
        Action:
          - sqs:SendMessage
        Resource: !ImportValue task-queue-queue-arn-${self:provider.stage}
      - Effect: Allow
        Action:
          - events:PutEvents
        Resource: "*"

  add-tasks:
    handler: src/handlers/add-tasks.handler
    description: Adds tasks to an existing job
    timeout: 30
    memorySize: 256
    events:
      - http:
          path: /jobs/{jobId}/tasks
          method: post
          private: true
    iamRoleStatements:
      - Effect: Allow
        Action:
          - dynamodb:Query
        Resource:
          - !ImportValue events-table-arn-${self:provider.stage}
          - !Join ['/', [!ImportValue events-table-arn-${self:provider.stage}, 'index', '*']]
      - Effect: Allow
        Action:
          - sqs:SendMessage
        Resource: !ImportValue task-queue-queue-arn-${self:provider.stage}
      - Effect: Allow
        Action:
          - events:PutEvents
        Resource: "*"

  list-jobs:
    handler: src/handlers/list-jobs.handler
    description: Lists all jobs with status
    timeout: 30
    memorySize: 256
    events:
      - http:
          path: /jobs
          method: get
          private: true
    iamRoleStatements:
      - Effect: Allow
        Action:
          - dynamodb:Query
        Resource:
          - !ImportValue events-table-arn-${self:provider.stage}
          - !Join ['/', [!ImportValue events-table-arn-${self:provider.stage}, 'index', '*']]

  get-job:
    handler: src/handlers/get-job.handler
    description: Gets job details with task statuses
    timeout: 30
    memorySize: 256
    events:
      - http:
          path: /jobs/{jobId}
          method: get
          private: true
    iamRoleStatements:
      - Effect: Allow
        Action:
          - dynamodb:Query
        Resource:
          - !ImportValue events-table-arn-${self:provider.stage}
          - !Join ['/', [!ImportValue events-table-arn-${self:provider.stage}, 'index', '*']]
```

---

## 10. Project Structure

```
producer-api/
├── serverless.yml
├── package.json
├── src/
│   ├── handlers/
│   │   ├── create-job.js       # POST /jobs
│   │   ├── add-tasks.js        # POST /jobs/{jobId}/tasks
│   │   ├── list-jobs.js        # GET /jobs
│   │   └── get-job.js          # GET /jobs/{jobId}
│   ├── lib/
│   │   ├── dag-validator.js    # Topological sort + validation
│   │   ├── event-builder.js    # GSI key computation
│   │   ├── job-queries.js      # DynamoDB query helpers
│   │   └── response.js         # API response formatting
│   └── config.js               # Env var config
```

### Dependencies

```json
{
  "@aws-sdk/client-sqs": "^3.911.0",
  "@aws-sdk/client-eventbridge": "^3.911.0",
  "@aws-sdk/lib-dynamodb": "^3.911.0",
  "@aws-sdk/client-dynamodb": "^3.911.0"
}
```

---

## 11. Architecture Summary

```
Client
  │
  │  x-api-key header
  ▼
┌────────────────────────────────────────────────┐
│           API Gateway (REST)                    │
│  • API Key validation (Usage Plan)             │
│  • Rate limiting (100 req/s, 50 burst)         │
│  • Quota (10,000 req/day)                      │
└──────────────────┬─────────────────────────────┘
                   │ Lambda proxy integration
                   ▼
┌────────────────────────────────────────────────┐
│           Lambda Functions                      │
│                                                 │
│  POST /jobs         → create-job.handler       │
│  POST /jobs/{}/tasks → add-tasks.handler       │
│  GET  /jobs         → list-jobs.handler        │
│  GET  /jobs/{}      → get-job.handler          │
└───────┬──────────┬──────────┬──────────────────┘
        │          │          │
        ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────────┐
   │  SQS   │ │ Event  │ │ DynamoDB   │
   │ Queue  │ │ Bridge │ │ (queries)  │
   └────────┘ └───┬────┘ └────────────┘
                  │
                  ▼
           ┌─────────────┐
           │ save-event-  │
           │ to-dynamo    │──→ DynamoDB (writes)
           │ Lambda       │
           └─────────────┘
```

---

## 12. Dispatcher Impact — Job Tasks Added

The Dispatcher Lambda ([job-orchestration.md](./job-orchestration.md)) must be updated to read `Job Tasks Added` events in addition to `Job Created`:

```javascript
// Current (reads only Job Created):
const jobEvent = await getJobCreatedEvent(jobId);
const taskDag = jobEvent.properties.tasks;

// Updated (reads Job Created + all Job Tasks Added):
const allJobEvents = await getAllJobEvents(jobId);   // GSI1: JOB#{jobId}
const jobCreated = allJobEvents.find(e => e.eventType === 'Job Created');
const tasksAdded = allJobEvents.filter(e => e.eventType === 'Job Tasks Added');

let taskDag = [...jobCreated.properties.tasks];
for (const added of tasksAdded) {
  taskDag = [...taskDag, ...added.properties.newTasks];
}
```

The Dispatcher EventBridge pattern does not change — it already triggers on `Task Completed` and `Task Failed`, which handles both original and dynamically-added tasks.

---

## 13. Deploy

```bash
cd producer-api

# Deploy
npx serverless deploy --stage dev
npx serverless deploy --stage prod

# Get API key value (for client configuration)
npx serverless info --stage dev

# Test
curl -X POST https://xxx.execute-api.eu-west-1.amazonaws.com/dev/jobs \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      { "taskId": "task-a", "name": "scrape-store", "dependsOn": [], "input": {"url": "..."} },
      { "taskId": "task-b", "name": "color-tags", "dependsOn": ["task-a"], "input": {} }
    ]
  }'

# View logs
npx serverless logs -f create-job --stage dev --tail
```
