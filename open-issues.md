# Open Issues

Remaining gaps in the system spec. Each issue includes the problem, why it matters, and suggested direction.

Related docs: [consumer-architecture.md](./consumer-architecture.md), [event-system.md](./event-system.md), [health-check.md](./health-check.md), [job-orchestration.md](./job-orchestration.md)

---

## Resolved

### ~~1. Worker Event Builder (CJS)~~

**Resolution**: Use existing `EventEmitterService` via dynamic `import()` — same pattern already used for `error-classifier.js`. The worker loads the ESM module at startup with `await import('../services/event-emitter-service.js')`. No code duplication, single source of truth for GSI key computation.

**Updated in**: consumer-architecture.md §1 (Module System).

### ~~2. Dispatcher Race Condition~~

**Resolution**: Accepted risk — probability negligible. Tasks involve Claude API calls that take minutes. Two tasks completing within the same second (required for overlapping Dispatcher invocations) is practically impossible. Even if it happens, worst case is a duplicate task execution — no data corruption.

---

### ~~3. EventBridge Rule DLQ / Retry~~

**Resolution**: Added DLQ (SQS) on EventBridge Rule target with RetryPolicy (3 retries, 1h max age). A `eventbridge-dlq-alert` Lambda consumes the DLQ and sends Slack alerts. No auto-retry — failed events are stored for 14 days for manual investigation.

**Updated in**: event-system.md (EventBridge Rule section, new DLQ Alert Lambda section).

---

## Medium

### ~~4. Task Timeout vs Task Failed — Clear Rules~~

**Resolution**: `Task Timeout` = only when the **worker** kills the child process externally (CLAUDE_TIMEOUT → SIGTERM → SIGKILL). Everything from inside the child process (including internal AbortController timeouts) goes through `error-classifier.js` and emits `Task Failed` or `Task Processing Failed` based on retryability.

| Scenario | Event |
|----------|-------|
| Worker kills child (external timeout) | `Task Timeout` |
| Child internal timeout (AbortController) | `Task Processing Failed` (retryable) |
| Child network error | `Task Processing Failed` (retryable) |
| Child auth/validation error | `Task Failed` (non-retryable) |
| Child programming error | `Task Failed` (non-retryable) |
| DLQ (retries exhausted) | `Task Failed` (terminal) |

**Updated in**: event-system.md (Event Types table), consumer-architecture.md §1 (error classification flow).

---

### ~~5. Job Failure Policy~~

**Resolution**: Renamed `Job Failed` → `Job Failure Detected`. This is a detection event, not a terminal state. Policy:

- **a)** In-progress tasks continue running — their results may be needed when the job is resumed
- **b)** Dispatcher keeps dispatching ready tasks even after failure detection — independent branches continue
- **c)** All partial results are kept in S3 — the job can be resumed from where it left off
- **Idempotent**: Dispatcher checks if `Job Failure Detected` was already emitted before emitting again

**Updated in**: event-system.md (event type renamed), job-orchestration.md (Dispatcher logic, Job State Machine, concept description).

---

### ~~6. effectiveUntil Calculation~~

**Resolution**: Keep `effectiveUntil` — self-describing events are an architectural value (readers don't need worker config, single timestamp comparison, multi-reader consistency). Evaluated removal across 10 scenarios: functionally safe but adds reader complexity for no benefit.

**Calculation**: `effectiveUntil = now + (VISIBILITY_EXTENSION_AMOUNT * 1.5)` — consistent for all non-terminal events (45s when extension is 30s). No special case for initial 900s visibility timeout (first heartbeat arrives in 20s and overrides). The ×1.5 multiplier accounts for clock skew.

| Event | effectiveUntil |
|-------|---------------|
| Task Processing Started | `now + VISIBILITY_EXTENSION_AMOUNT * 1.5` |
| Task Heartbeat | `now + VISIBILITY_EXTENSION_AMOUNT * 1.5` |
| Terminal events | `null` |

**Updated in**: consumer-architecture.md §6 (Idempotency), event-system.md (Heartbeat properties), health-check.md (Heartbeat event example).

---

### ~~7. Per-Event Properties (TODO)~~

**Resolution**: All 14 event types fully specified with minimum necessary properties. Each event includes: which consumers need it, why, and only the fields those consumers require.

**Updated in**: event-system.md (Event Properties per Type section).

---

## Low

### ~~8.5 Task Definition Registry~~

**Resolution**: Each task type has a `name`, `description` (what needs to be done), and `tag` (which role should do it). Stored in a dedicated DynamoDB table (`task-definitions-{stage}`). Consumer looks up definitions at execution time to build Claude prompts. Producer validates task names at job creation. Management via `PUT /task-definitions/{name}` and `GET /task-definitions` endpoints.

**Specified in**: [task-registry.md](./task-registry.md)

---

### 8. S3 Bucket Details

**Status**: Mentioned in infrastructure stack table but no bucket configuration (lifecycle rules, encryption, CORS, etc.). Low priority — standard S3 bucket, can be defined at implementation time.

### ~~9. Producer Spec~~

**Resolution**: Full API specification created. API Gateway REST API with Lambda proxy integration, API Key authentication, 4 endpoints (create job, add tasks, list jobs, get job details). Includes DAG validation (topological sort), per-task input handling, and new `Job Tasks Added` event type for dynamic task addition.

**Specified in**: [producer-api.md](./producer-api.md)

### 10. Worker Complexity Increase

**Status**: Awareness item. The new worker talks to 3 AWS services (SQS + EventBridge + DynamoDB) instead of 1 (SQS). This means more dependencies, more failure modes, more credentials. Not a gap to close — just something to keep in mind during implementation.

### 11. Testing Strategy

**Status**: Deferred to implementation phase. Key areas that will need tests:
- Idempotency: conditional writes, effectiveUntil expiry, race conditions
- Dispatcher: DAG dependency resolution, set math for task readiness
- Health classifier: threshold edge cases
- Event builder: GSI key correctness for all entity types
- DLQ processor: terminal event emission
