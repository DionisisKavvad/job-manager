# Consumer Architecture

SQS worker consumer that processes tasks via Claude Agent SDK. Receives messages from SQS, spawns isolated child processes, executes tasks, uploads results to S3, and emits events to EventBridge.

This document is the **complete spec** for re-implementation.

---

## High-Level Flow

```
                                    ┌────────────────────────┐
                                    │  Producer (other system)│
                                    │                         │
                                    │  1. Emit "Task Pending" │
                                    │  2. SendMessage to SQS  │
                                    └────────────┬────────────┘
                                                 │
                                                 ▼
                         ┌──────────────────────────────────────────────┐
                         │              AWS SQS Queue (Standard)        │
                         │  • At-least-once delivery                    │
                         │  • Visibility timeout extended periodically  │
                         │  • DLQ after 3 failed attempts               │
                         └──────────────┬───────────────────────────────┘
                                        │ Long polling (20s)
                                        ▼
                         ┌──────────────────────────────────────────────┐
                         │         sqs-worker.cjs (PM2 x3)             │
                         │                                              │
                         │  • Polls SQS messages                       │
                         │  • Validates requestId                       │
                         │  • Checks retry count                        │
                         │  • Extends visibility timeout                │
                         │  • Emits heartbeat events                    │
                         │  • Spawns child process                      │
                         │  • Classifies errors on failure              │
                         │  • Deletes message on success/permanent fail │
                         └──────────────┬───────────────────────────────┘
                                        │ child_process.spawn()
                                        │ (filtered env allowlist)
                                        ▼
                         ┌──────────────────────────────────────────────┐
                         │       task-workflow.js (ES Module)           │
                         │                                              │
                         │  • Loads task input data                     │
                         │  • Executes task (Claude Agent SDK)          │
                         │  • Executes task (Claude Agent SDK)          │
                         │  • Uploads results to S3                     │
                         │  • process.exit(0) or process.exit(1)        │
                         └──────────────┬───────────────────────────────┘
                                        │
                              ┌─────────┴──────────┐
                              ▼                    ▼
                       ┌───────────┐      ┌──────────────┐
                       │  S3 Upload│      │  EventBridge  │
                       │  results  │      │  events       │
                       │  + logs   │      └──────┬────────┘
                       └───────────┘             │
                                                 ▼
                                          ┌──────────────┐
                                          │ Lambda Consumer│
                                          │ → DynamoDB    │
                                          └──────────────┘
```

---

## 1. SQS Worker (`src/worker/sqs-worker.cjs`)

CommonJS module (required for `child_process.spawn`). Runs via PM2 in cluster mode.

### PM2 Configuration (`ecosystem.config.cjs`)

| Setting | Value |
|---------|-------|
| Instances | 3 (cluster mode) |
| Memory limit | 1GB per instance |
| Auto-restart | max 10 retries, min 10s uptime |
| Restart delay | 5000ms |
| Kill timeout | 5000ms |
| Cron restart | Daily at 2 AM |
| Log files | `.output/logs/{err,out,combined}.log` |

### Module System

- **sqs-worker.cjs** — CommonJS (for `child_process.spawn` compatibility)
- **task-workflow.js** — ES Module (everything else)
- **aws-credentials.cjs** — CommonJS duplicate (worker needs it)
- Dynamic import bridge (loaded at startup):
  - `import('../utils/error-classifier.js')` — error classification
  - `import('../services/event-emitter-service.js')` — event emission to EventBridge

The worker uses Node.js dynamic `import()` to load ES Modules from CJS context. This is the same pattern already used for `error-classifier.js`. The `EventEmitterService` handles all GSI key computation, metadata, and `PutEventsCommand` calls — single source of truth for event building.

### Polling Loop

```
while (running) {
  messages = pollSQS(maxMessages, waitTimeSeconds=20)
  for each message (concurrency limit = MAX_CONCURRENT_CLAUDE):
    processMessage(message)
  sleep(1 second)
}
```

### Message Processing

1. Parse message body (JSON)
2. Extract `requestId` from `message.MessageAttributes.requestId.StringValue`
3. Validate format: `/^[a-zA-Z0-9-_]{1,256}$/`
4. Check `ApproximateReceiveCount` against `MAX_MESSAGE_RETRIES` (3)
5. Start visibility extension interval
6. Spawn child process → wait for exit
7. On exit 0: delete message
8. On child exit with error: two paths depending on **who** killed the process:
   - **Worker killed child** (CLAUDE_TIMEOUT expired → SIGTERM → SIGKILL): emit `Task Timeout` → delete message
   - **Child exited on its own** (exit code 1): classify error with `error-classifier.js`:
     - Programming error (TypeError, ReferenceError, SyntaxError, RangeError): emit `Task Failed` → delete immediately
     - Retryable (network, rate limit, internal timeout via AbortController): emit `Task Processing Failed` → keep message for SQS retry
     - Non-retryable (auth, validation): emit `Task Failed` → delete to prevent infinite loop
   - If all retries exhausted → SQS moves to DLQ → DLQ Lambda emits `Task Failed` (terminal)

### Visibility Extension

```javascript
setInterval(async () => {
  await ChangeMessageVisibility({
    QueueUrl, ReceiptHandle,
    VisibilityTimeout: VISIBILITY_EXTENSION_AMOUNT  // default 30s
  });
}, VISIBILITY_EXTENSION_INTERVAL);  // default 20000ms
```

- Max consecutive failures: 3 → stops extension attempts
- On process exit (success or failure): `clearInterval`

### Secure Environment Filtering

Only allowlisted env vars passed to child process:

| Category | Variables |
|----------|-----------|
| System | `PATH`, `HOME`, `USER`, `SHELL`, `TMPDIR`, `PWD` |
| Locale | `LANG`, `LC_ALL`, `LC_CTYPE`, etc. |
| Terminal | `TERM`, `COLORTERM`, `FORCE_COLOR` |
| Node.js | `NODE_ENV` |
| Claude | `CLAUDE_CODE_PATH`, `CLAUDE_CONFIG_DIR`, `CLAUDE_TIMEOUT`, `MAX_CONCURRENT_CLAUDE`, `CLAUDE_SKIP_PERMISSIONS` |
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| App | `S3_BUCKET`, `DELETE_FILES_AFTER_UPLOAD`, `EVENTBRIDGE_BUS_NAME`, `TENANT_ID`, `APP_NAME`, `TASK_DEFINITIONS_TABLE` |

### Child Process Spawn

```javascript
spawn('node', ['src/workflow/task-workflow.js', requestId, JSON.stringify(inputData)], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: filteredEnv,
  cwd: process.cwd()
});
```

- stdin closed immediately (`workflowProcess.stdin.end()`)
- stdout/stderr streamed with `[WORKFLOW:{requestId}]` prefix
- Timeout: `CLAUDE_TIMEOUT` ms → SIGTERM → SIGKILL after 5s

### Concurrency Control

```javascript
processConcurrently(messages, processMessage, MAX_CONCURRENT_CLAUDE);
```

Promise-based limiter: processes up to `MAX_CONCURRENT_CLAUDE` (default 3) messages in parallel.

### Graceful Shutdown

- SIGINT/SIGTERM → `process.exit(0)`
- Uncaught exceptions → `process.exit(1)`
- Unhandled rejections → `process.exit(1)`

### DLQ Processing Lambda (event stack)

When a message exhausts all SQS retries (maxReceiveCount: 3) it moves to the DLQ silently — no code runs, no event emitted. Without intervention, the task stays in "processing" state forever.

A Lambda triggered by the DLQ emits the terminal `Task Failed` event:

```
SQS DLQ → Lambda → emits "Task Failed" event
                    (reason: "max retries exhausted, moved to DLQ")
```

This Lambda lives in the **event stack** (alongside save-event-to-dynamo) because its sole purpose is ensuring event completeness.

```yaml
# event stack — serverless.yml
  dlq-processor:
    handler: src/dlq-processor.handler
    description: Emits Task Failed for DLQ'd messages
    timeout: 30
    memorySize: 256
    events:
      - sqs:
          arn: !ImportValue task-queue-dlq-arn-${self:provider.stage}
          batchSize: 1
    iamRoleStatements:
      - Effect: Allow
        Action:
          - events:PutEvents
        Resource: "*"
```

---

## 2. Task Workflow (`src/workflow/task-workflow.js`)

ES Module. Entry point for the child process. Generic task executor.

### Initialization

- Parse CLI args: `requestId`, input data (JSON)
- Load task input from: CLI arg → `INPUT_FILE` env → `inputs/input.json`
- Create output directories, loggers

### Execution Flow

```
1. Load task input
2. Initialize AgentWorkflow with step definitions
3. Execute task (Claude Agent SDK)
4. Upload results to S3
5. process.exit(0) on success, process.exit(1) on failure
```

### Output Structure

```
.output/{requestId}/
  ├── artifacts/          # JSON results
  │   └── task-result.json
  ├── logs/               # Execution logs
  │   └── summary.log
  └── traces/             # SDK hooks analytics
      └── session_trace.json
```

### Post-Task

- Upload artifacts + logs to `s3://{bucket}/task/logs/{requestId}/`
- Optional: delete local files after upload (`DELETE_FILES_AFTER_UPLOAD`)
- `process.exit(0)` or `process.exit(1)`

---

## 3. Agent Workflow (`src/workflow/agent-workflow.js`)

Wraps the Claude Agent SDK. Executes the task via structured prompt + JSON schema output.

### Step Definition

```javascript
workflow.addStep({
  name: 'task-step',
  constructedPrompt: '...',       // dynamic prompt with placeholders replaced
  outputSchema: { ... },          // JSON Schema — Claude must return valid JSON
  outputFile: 'task-result.json',
  maxTurns: 10,                   // max agent turns (default 30)
  tools: [],                      // allowed tools (empty = no tools)
  timeout: 300000,                // step-specific timeout
  processOutput: async (output) => { ... }  // post-processing
})
```

### SDK Call

```javascript
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

const generator = sdkQuery({
  prompt: sanitizedPrompt,
  options: {
    model: CLAUDE_MODEL || 'inherit',
    maxTurns: step.maxTurns,
    permissionMode: 'acceptEdits',
    cwd: process.cwd(),
    hooks: hooksManager.getHooksConfig(),
    allowedTools: step.tools,
    abortController,                       // timeout via AbortController
    outputFormat: {
      type: 'json_schema',
      schema: step.outputSchema
    }
  }
});

for await (const message of generator) {
  // message.type: 'assistant' | 'tool_use' | 'result'
  if (message.type === 'result') {
    // message.structured_output = validated JSON
    // message.usage = { input_tokens, output_tokens, cache_read_tokens }
    // message.duration_ms, message.num_turns, message.total_cost_usd
  }
}
```

### Retry Logic (`withRetry`)

- 3 attempts with exponential backoff + jitter
- Retryable: timeout, network, rate limit, server error
- Non-retryable: auth failure, validation, parse error, not found
- Classification via unified `error-classifier.js`

### Timeout Handling

- `AbortController` with configurable timeout
- Range: 1s–15min (clamped), default 5min
- SIGTERM on abort → classified as TIMEOUT error

---

## 4. SDK Hooks Manager (`src/workflow/sdk-hooks-manager.js`)

Provides observability into Claude SDK execution.

**Tracked data per step**:
- Tool calls: name, duration, input/output
- Cache metrics: input tokens, cache read tokens, efficiency %
- Todo timing: state machine (pending → in_progress → completed) with durations

**Output**: `session_trace.json` per step with full execution analytics.

---

## 5. Event System

> Full specification: **[event-system.md](./event-system.md)**

The consumer emits the following events:

| Event | When | Emitted By |
|-------|------|------------|
| `Task Processing Started` | Worker spawns child process | sqs-worker |
| `Task Processing Failed` | Retryable error (attempt-level) | sqs-worker |
| `Task Completed` | Child exits with code 0 | sqs-worker |
| `Task Failed` | Non-retryable error, or DLQ (terminal) | sqs-worker / DLQ Lambda |
| `Task Timeout` | Child process killed by worker | sqs-worker |
| `Task Heartbeat` | On visibility extension | sqs-worker |

**Key design**: The sqs-worker emits workflow-level events directly (not the child process). This ensures events are recorded even if the child is killed (SIGKILL).

For event structure, GSI keys, DynamoDB schema, persistence Lambda, task state tracking, and query patterns — see [event-system.md](./event-system.md).

---

## 6. Idempotency & Locking

Transforms SQS at-least-once delivery into **exactly-once processing** using DynamoDB events as a distributed lock.

### The `effectiveUntil` Mechanism

State expiration encoded directly in the event. Self-describing: readers check a single timestamp without needing to know worker configuration.

**Calculation**: `effectiveUntil = now + (VISIBILITY_EXTENSION_AMOUNT * 1.5)`

The ×1.5 multiplier (45s when extension is 30s) provides a buffer for clock skew between workers. Consistent formula for all non-terminal events — no special case for the initial visibility timeout (900s), because the first heartbeat arrives in 20s and overrides it.

| Event | effectiveUntil |
|-------|----------------|
| Task Processing Started | `now + VISIBILITY_EXTENSION_AMOUNT * 1.5` (45s) |
| Task Heartbeat | `now + VISIBILITY_EXTENSION_AMOUNT * 1.5` (45s) |
| Task Completed / Failed / Timeout | `null` (terminal states never expire) |

**State check = single timestamp comparison**:

```javascript
const latestEvent = queryLatestEvent(requestId);  // GSI1, Limit: 1
const effectiveUntil = latestEvent.properties.effectiveUntil;

if (effectiveUntil !== null && Date.now() > effectiveUntil) {
  return null; // State expired — treat as no state
}
return EVENT_TO_STATE[latestEvent.eventType];
```

### Processing Decision Tree

```
Worker receives SQS message
       │
       ▼
Query GSI1 for latest event (TASK#{requestId})
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Latest event state:                                   │
│                                                       │
│ null (no events)     → First time → proceed           │
│                                                       │
│ COMPLETED            → Duplicate! Delete immediately  │
│                                                       │
│ PROCESSING           → Check effectiveUntil:          │
│   now < effectiveUntil → Another worker active, skip  │
│   now > effectiveUntil → Worker crashed, safe retry   │
│                                                       │
│ FAILED               → Check retryCount:              │
│   retryCount < MAX   → Allow retry                    │
│   retryCount >= MAX  → Delete, move to DLQ            │
└──────────────────────────────────────────────────────┘
       │
       ▼
Record "Task Processing Started" with conditional write
(prevents race conditions between workers)
```

### Conditional Write (Optimistic Lock)

```javascript
await ddbClient.send(new PutCommand({
  TableName: TABLE_NAME,
  Item: processingStartedEvent,
  ConditionExpression: 'attribute_not_exists(PK) OR #cs = :expected',
  ExpressionAttributeNames: { '#cs': 'properties.currentState' },
  ExpressionAttributeValues: { ':expected': expectedState }
}));
// ConditionalCheckFailedException → another worker won → back off
```

### Scenarios

**Happy path**:
```
Worker A: Query → null → Record Processing Started (lock) → Execute → Record Completed → Delete SQS
```

**Duplicate delivery**:
```
Worker B: Query → COMPLETED → Delete SQS message (no reprocessing)
```

**Race condition (two workers, same message)**:
```
Worker A: Conditional write → SUCCESS ✓ → Proceeds
Worker B: Conditional write → ConditionalCheckFailedException ✗ → Backs off
```

**Worker crash recovery**:
```
Worker A: Record Processing Started (effectiveUntil: 12:00:45) → Crashes at 12:00:10
SQS redelivers at 12:05:00
Worker B: Query → PROCESSING, but now > effectiveUntil → Expired → Safe to retry
```

**Long-running task with heartbeats**:
```
Worker A: Record Processing Started (effectiveUntil: 12:00:45)
Worker A: At 12:00:20 → Record Heartbeat (effectiveUntil: 12:01:05)
Worker B: At 12:00:50 → Query → effectiveUntil 12:01:05 > now → Still active → Skip
Worker A: Completes at 12:00:55 → Record Completed
```

---

## 7. Heartbeat Events & Health Check

> Full specification: **[health-check.md](./health-check.md)**

Heartbeat events piggybacking on visibility extension + a scheduled Health Check Lambda that detects stuck/overtime tasks and alerts via Slack.

---

## 8. Job Orchestration

> Full specification: **[job-orchestration.md](./job-orchestration.md)**

Dispatcher Lambda for multi-task DAG workflows — triggered by task completion events, enqueues ready tasks to SQS.

---

## 9. Error Classification (`src/utils/error-classifier.js`)

Unified classification used across all layers:

| Category | Retryable | Examples |
|----------|-----------|----------|
| Auth | No | 401/403, AuthenticationError |
| Validation | No | 400, ValidationError, invalid requestId |
| Parse | No | SyntaxError, JSON parse errors |
| Not Found | No | ENOENT, missing modules |
| Timeout | Yes | TIMEOUT code, AbortError |
| Network | Yes | ECONNREFUSED, ENOTFOUND, ECONNRESET |
| Rate Limit | Yes | 429, RateLimitError |
| Server Error | Yes | 500+ status codes |

---

## 10. Security (`src/security/`)

| File | Purpose |
|------|---------|
| `input-sanitizer.js` | Sanitize prompt inputs before sending to Claude |
| `error-sanitizer.js` | Strip sensitive data from error messages |
| `index.js` | Re-exports: `sanitizePromptInput`, `sanitizeErrorMessage` |

---

## 11. Supporting Utilities

| File | Purpose |
|------|---------|
| `src/utils/retry.js` | `withRetry()` — exponential backoff + jitter |
| `src/utils/aws-credentials.js` | AWS credential loading (ESM) |
| `src/utils/aws-credentials.cjs` | AWS credential loading (CJS — for worker) |
| `src/utils/format.js` | Output formatting helpers |
| `src/utils/error-classifier.js` | Unified error classification |
| `src/workflow/prompt-template.js` | Prompt template builder with placeholder replacement |
| `src/workflow/workflow-logger.js` | File-based logging per workflow |
| `src/workflow/summary-builder.js` | Execution summary generation |
| `src/workflow/sdk-hooks-manager.js` | Claude SDK hooks for observability |

---

## 12. Infrastructure

All shared resources live in a dedicated **infrastructure stack** (`serverless.yml`). Other stacks (event, health-check, dispatcher) import via CloudFormation Exports.

### Infrastructure Stack Resources

| Resource | Type | Key Settings |
|----------|------|-------------|
| SQS Queue | `AWS::SQS::Queue` | VisibilityTimeout: 900s, Long polling: 20s, DLQ after 3 retries |
| SQS DLQ | `AWS::SQS::Queue` | Retention: 14 days |
| DynamoDB Events Table | `AWS::DynamoDB::Table` | PAY_PER_REQUEST, 7 GSIs (ALL), TTL on `ttl` |
| EventBridge Bus | `AWS::Events::EventBus` | Custom bus per stage |
| S3 Bucket | `AWS::S3::Bucket` | Artifacts, logs, event overflow |

Full DynamoDB schema: [event-system.md](./event-system.md) (DynamoDB Table Schema section).

### Serverless Stacks

| Stack | Contains | Depends On |
|-------|----------|-----------|
| **infrastructure** | SQS, DLQ, DynamoDB, EventBridge Bus, S3 | — |
| **producer-api** | API Gateway, create-job/add-tasks/list-jobs/get-job Lambdas, task-definitions CRUD, TaskDefinitionsTable | infrastructure |
| **event** | save-event-to-dynamo Lambda, DLQ processor Lambda, EventBridge Rule | infrastructure |
| **health-check** | Health Check Lambdas, Scheduler | infrastructure |
| **dispatcher** | Dispatcher Lambda, EventBridge Rule | infrastructure |
| **consumer** (PM2) | sqs-worker.cjs + task-workflow.js | infrastructure (env vars) |

### Serverless Framework v4 Conventions

- `build: esbuild: true`
- `runtime: nodejs22.x`
- `iamRoleStatements` per function (not global)
- Config from `${file(../../../config/config.${stage}.yml)}`
- Dev/prod schedule toggles: `rate(365 days)` / `rate(5 minutes)` + `enabled: false/true`
- Slack: `SLACK_BOT_TOKEN` + `ALERT_CHANNEL` from config (no SNS)

---

## 13. Environment Variables

| Variable | Default | Used By |
|----------|---------|---------|
| `AWS_REGION` | `eu-west-1` | All AWS clients |
| `AWS_ACCESS_KEY_ID` | — | AWS auth |
| `AWS_SECRET_ACCESS_KEY` | — | AWS auth |
| `SQS_QUEUE_URL` | — | SQS worker |
| `MAX_MESSAGES` | `1` | SQS polling |
| `VISIBILITY_TIMEOUT` | `30` | SQS initial visibility |
| `WAIT_TIME_SECONDS` | `20` | SQS long polling |
| `VISIBILITY_EXTENSION_INTERVAL` | `20000` | Heartbeat interval (ms) |
| `VISIBILITY_EXTENSION_AMOUNT` | `30` | Visibility extension (seconds) |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Claude SDK auth |
| `CLAUDE_MODEL` | `claude-opus-4-5` | Model selection |
| `CLAUDE_TIMEOUT` | `200000` | Child process timeout (ms) |
| `MAX_CONCURRENT_CLAUDE` | `3` | Concurrent workflows |
| `DEFAULT_TIMEOUT` | `120000` | SDK step timeout (ms) |
| `DYNAMODB_EVENTS_TABLE_NAME` | `dev-unifiedEvents` | Event emitter |
| `TENANT_ID` | — | DynamoDB PK |
| `APP_NAME` | `task-workflow` | GSI2/3/6/7 |
| `EVENTBRIDGE_BUS_NAME` | `default` | EventBridge bus |
| `MAX_MESSAGE_RETRIES` | `3` | SQS retry limit |
| `PROCESSING_TIMEOUT_MS` | `20000` | (documented, unused in current code) |
| `S3_BUCKET` | — | Upload artifacts |
| `DELETE_FILES_AFTER_UPLOAD` | `false` | Cleanup local files |
| `NODE_ENV` | `dev` | Environment |

---

## 14. Dependencies

```json
{
  "@anthropic-ai/claude-agent-sdk": "^0.1.76",
  "@anthropic-ai/sdk": "^0.67.0",
  "@aws-sdk/client-eventbridge": "^3.911.0",
  "@aws-sdk/client-s3": "^3.955.0",
  "@aws-sdk/client-sqs": "^3.911.0",
  "dotenv": "^17.2.3",
  "uuid": "^11.0.4"
}
```

**New dependencies needed**:
- `@aws-sdk/lib-dynamodb` — DynamoDB DocumentClient (for idempotency, health check)
- `@slack/web-api` — Slack alerting (health check Lambda)

**Module system**: ES Modules (`"type": "module"`) except `sqs-worker.cjs` and `aws-credentials.cjs`.

---

## 15. Key Constraints

- **Max 3 concurrent tasks** (`MAX_CONCURRENT_CLAUDE`)
- **Visibility timeout must exceed task duration** — extended periodically
- **Child process timeout** (`CLAUDE_TIMEOUT`) — SIGTERM then SIGKILL after 5s
- **Max 3 SQS retries** — then message goes to DLQ
- **Standard SQS queue** (not FIFO) — idempotency via DynamoDB events

---

## 16. Implementation Checklist

Key items for the new project:

| Item | Section |
|------|---------|
| Worker emits events directly to EventBridge (not only child process) | §1, §5 |
| Worker emits heartbeat on visibility extension | §7 (health-check.md) |
| Worker emits `Task Timeout` on child SIGKILL | §5 |
| Idempotency: conditional writes + effectiveUntil | §6 |
| CJS/ESM bridge: direct EventBridge client in worker (no ESM import needed) | §7 (health-check.md) |
| Health Check Lambda (Serverless Framework v4) | §7 (health-check.md) |
| Dispatcher Lambda for job orchestration | §8 (job-orchestration.md) |
| save-event-to-dynamo Lambda (event persistence) | event-system.md |
| Test framework for state machines, set math, DAG logic | — |
