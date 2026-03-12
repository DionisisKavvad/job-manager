# Job Manager — Project Analysis

## Overview

Ένα **event-sourced, serverless σύστημα orchestration** που εκτελεί DAG-based workflows χρησιμοποιώντας **Claude Agent SDK** ως compute engine. Built on AWS (Lambda, SQS, EventBridge, DynamoDB, S3) με React frontend dashboard.

**Codebase:** ~2,966 γραμμές κώδικα σε 7 services (monorepo με npm workspaces)

---

## Τι Είναι και Για Τι Χρησιμοποιείται

Το Job Manager είναι ουσιαστικά ένα **AI-powered code automation platform**. Κάθε "job" είναι ένα σύνολο αλληλεξαρτώμενων tasks που εκτελούνται **πάνω σε πραγματικά GitHub repositories** από τον Claude Agent — δηλαδή ένα LLM που μπορεί να διαβάζει, γράφει, και τρέχει κώδικα αυτόνομα.

### Η Βασική Ιδέα

Αντί να γράψεις κώδικα χειροκίνητα, περιγράφεις **τι θέλεις** σε φυσική γλώσσα, δίνεις το repo, και ο Claude Agent:
1. Κάνει clone το repo σε isolated worktree
2. Διαβάζει τον υπάρχοντα κώδικα (Read, Glob, Grep)
3. Γράφει/τροποποιεί αρχεία (Write, Edit)
4. Τρέχει commands (Bash) — tests, builds, linting
5. Αν κάτι αποτύχει, το feedback loop τον ξανατρέχει με context του error
6. Παράγει output (structured JSON ή text) που περνάει στα εξαρτημένα tasks

### Γιατί το `repo` field

Κάθε task μπορεί να δουλεύει σε **διαφορετικό repository**. Αυτό σημαίνει ότι ένα job μπορεί να span across πολλαπλά repos. Πχ:
- Task A: Αλλάζει το API στο `backend-repo`
- Task B (depends on A): Ενημερώνει τον client στο `frontend-repo` βάσει των αλλαγών
- Task C (depends on B): Τρέχει E2E tests στο `e2e-repo`

Κάθε task δημιουργεί **δικό του git branch** (`task/{taskId}`) μέσα σε ένα **isolated worktree** στο `/tmp/job-manager-tasks/{taskId}`, οπότε δεν υπάρχει κίνδυνος conflict μεταξύ concurrent tasks.

Αν ένα task **δεν** χρειάζεται repo (πχ data analysis, scraping), το `repo` field παραλείπεται και ο agent τρέχει χωρίς git context.

---

## Πρακτικά Παραδείγματα Jobs

### Παράδειγμα 1: Feature Implementation με Review

**Σενάριο:** Θέλεις να προστεθεί ένα νέο API endpoint με tests σε ένα Node.js project.

```json
POST /jobs
{
  "tasks": [
    {
      "taskId": "implement-endpoint",
      "name": "Implement GET /users/:id/orders endpoint",
      "tag": "backend-developer",
      "description": "Create a new GET endpoint at /users/:id/orders that returns paginated orders for a user. Use the existing Order model and follow the patterns in src/routes/users.ts. Include query params: page, limit, status filter. Return 404 if user not found.",
      "repo": "myorg/ecommerce-api",
      "input": {
        "techStack": "Express + TypeScript + Prisma",
        "existingEndpoints": "/users, /users/:id, /orders"
      },
      "allowedTools": ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      "maxTurns": 30,
      "requiresReview": true,
      "feedbackCommands": {
        "lint": "npm run lint",
        "typecheck": "npx tsc --noEmit",
        "test": "npm test"
      }
    },
    {
      "taskId": "write-tests",
      "name": "Write integration tests for orders endpoint",
      "tag": "test-engineer",
      "description": "Write comprehensive integration tests for the GET /users/:id/orders endpoint. Cover: happy path, pagination, status filter, user not found (404), invalid params (400). Use the existing test patterns in __tests__/.",
      "repo": "myorg/ecommerce-api",
      "dependsOn": ["implement-endpoint"],
      "allowedTools": ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      "maxTurns": 25,
      "feedbackCommands": {
        "lint": "npm run lint",
        "test": "npm test"
      }
    }
  ]
}
```

**Τι γίνεται βήμα-βήμα:**

1. **Job Creation:** Ο Producer δημιουργεί `job-abc123`, εκπέμπει events. Μόνο το `implement-endpoint` είναι root task (δεν εξαρτάται από κάτι) — γίνεται αμέσως pending.

2. **Task 1 — `implement-endpoint`:**
   - Ο Worker κάνει bare clone το `myorg/ecommerce-api`
   - Δημιουργεί worktree στο `/tmp/job-manager-tasks/implement-endpoint` (branch: `task/implement-endpoint`)
   - Ο Claude Agent παίρνει prompt:
     ```
     # Role
     You are a backend-developer.

     # Task
     Create a new GET endpoint at /users/:id/orders...

     # Input
     { "techStack": "Express + TypeScript + Prisma", ... }

     # Validation
     After you finish, the following commands will be run:
     - lint: npm run lint
     - typecheck: npx tsc --noEmit
     - test: npm test
     ```
   - Ο agent διαβάζει τα υπάρχοντα routes, τo Prisma schema, τα patterns
   - Γράφει τον νέο endpoint, τον router, τα types
   - **Feedback Loop:** Τρέχει lint → typecheck → test
     - Αν το lint αποτύχει: ο agent ξανατρέχει με το error output και φτιάχνει τα issues
     - Max 2 rounds auto-fix
   - Αφού περάσουν όλα: **"Task Submitted For Review"** (γιατί `requiresReview: true`)

3. **Human Review:**
   - Ο reviewer βλέπει τον κώδικα στο dashboard
   - **Approve** → εκπέμπεται "Task Approved" → ξεκλειδώνει τα dependent tasks
   - **Request Revision** → εκπέμπεται "Task Revision Requested" → ο agent ξανατρέχει με το feedback (iteration 2, max 5)

4. **Task 2 — `write-tests` (ενεργοποιείται αφού ολοκληρωθεί το Task 1):**
   - Ο Dispatcher βλέπει ότι το `implement-endpoint` ολοκληρώθηκε
   - Στέλνει στο SQS message με `dependencyOutputs` που περιέχει το output του Task 1
   - Ο Claude Agent γνωρίζει τι ακριβώς έγινε implement και γράφει tests αναλόγως
   - Δεν χρειάζεται review → "Task Completed" → "Job Completed"

5. **Output (αποθηκεύεται στο S3):**
   ```
   s3://bucket/task/logs/implement-endpoint/
     artifacts/task-result.json    ← { "filesCreated": ["src/routes/orders.ts", ...], "summary": "..." }
     logs/summary.log              ← Execution log
     traces/session_trace.json     ← Tool calls, token usage, cache metrics
   ```

---

### Παράδειγμα 2: Multi-Repo Refactoring Pipeline

**Σενάριο:** Μετονομασία ενός shared type σε 3 repos (shared lib, backend, frontend).

```json
POST /jobs
{
  "tasks": [
    {
      "taskId": "update-shared-types",
      "name": "Rename UserProfile to AccountProfile in shared lib",
      "tag": "developer",
      "description": "Rename the UserProfile interface to AccountProfile in src/types/user.ts. Update all internal references. Export both names temporarily with a deprecation comment on UserProfile.",
      "repo": "myorg/shared-types",
      "feedbackCommands": {
        "typecheck": "npx tsc --noEmit",
        "test": "npm test"
      }
    },
    {
      "taskId": "update-backend",
      "name": "Update backend to use AccountProfile",
      "tag": "backend-developer",
      "description": "Replace all UserProfile imports/usages with AccountProfile. The shared-types package has been updated — use the new name everywhere.",
      "repo": "myorg/backend-api",
      "dependsOn": ["update-shared-types"],
      "feedbackCommands": {
        "typecheck": "npx tsc --noEmit",
        "test": "npm test"
      }
    },
    {
      "taskId": "update-frontend",
      "name": "Update frontend to use AccountProfile",
      "tag": "frontend-developer",
      "description": "Replace all UserProfile imports/usages with AccountProfile in the React app. Update component props, hooks, and store types accordingly.",
      "repo": "myorg/frontend-app",
      "dependsOn": ["update-shared-types"],
      "feedbackCommands": {
        "typecheck": "npx tsc --noEmit",
        "test": "npm test"
      }
    }
  ]
}
```

**Τι γίνεται:**
1. `update-shared-types` τρέχει πρώτο (root task)
2. Ο agent αλλάζει τα types, τρέχει typecheck + tests, output: `{ "renamed": "UserProfile → AccountProfile", "filesChanged": [...] }`
3. `update-backend` + `update-frontend` ξεκινούν **παράλληλα** (κανένα δεν εξαρτάται από το άλλο)
4. Κάθε agent λαμβάνει το output του shared-types task ως context:
   ```
   # Context from Previous Tasks
   { "update-shared-types": { "renamed": "UserProfile → AccountProfile", ... } }
   ```
5. Δουλεύουν σε **ξεχωριστά repos** + **ξεχωριστά worktrees** — πλήρες isolation

---

### Παράδειγμα 3: Data Pipeline (χωρίς repo)

**Σενάριο:** Scraping + ανάλυση δεδομένων — δεν χρειάζεται git repo.

```json
POST /jobs
{
  "tasks": [
    {
      "taskId": "scrape-data",
      "name": "Extract product data",
      "tag": "data-engineer",
      "description": "Use the provided API to fetch all products from the /api/products endpoint. Parse the response and extract: name, price, category, rating. Return a structured JSON array.",
      "input": {
        "apiBase": "https://api.example.com",
        "apiKey": "key-123"
      },
      "allowedTools": ["Bash", "Read", "Write"],
      "maxTurns": 15
    },
    {
      "taskId": "analyze-data",
      "name": "Analyze product pricing",
      "tag": "data-analyst",
      "description": "Analyze the product data from the previous task. Calculate: average price per category, price distribution, top 10 most expensive products, correlation between price and rating. Return results as structured JSON.",
      "dependsOn": ["scrape-data"],
      "allowedTools": ["Bash", "Read", "Write"],
      "maxTurns": 20
    },
    {
      "taskId": "generate-report",
      "name": "Generate markdown report",
      "tag": "technical-writer",
      "description": "Create a comprehensive markdown report from the analysis results. Include tables, key insights, and recommendations. Format it as a clean, presentable document.",
      "dependsOn": ["analyze-data"],
      "allowedTools": ["Write"],
      "maxTurns": 10
    }
  ]
}
```

**Εδώ κανένα task δεν έχει `repo`** — ο agent τρέχει στο current working directory χωρίς git operations. Τα tools περιορίζονται (πχ μόνο `Bash` + `Write` για scraping), και τα outputs chain μεταξύ τους.

---

### Παράδειγμα 4: Bug Fix με Automated Testing

**Σενάριο:** Ένα bug report → fix → verify → update changelog

```json
POST /jobs
{
  "tasks": [
    {
      "taskId": "investigate-bug",
      "name": "Investigate login timeout bug",
      "tag": "debugger",
      "description": "Users report that login times out after 30 seconds. Investigate the auth flow in src/auth/. Check for: unnecessary awaits, missing timeout configs, N+1 queries. Return a root cause analysis with the exact file and line.",
      "repo": "myorg/webapp",
      "allowedTools": ["Read", "Glob", "Grep", "Bash"],
      "maxTurns": 20
    },
    {
      "taskId": "fix-bug",
      "name": "Fix the login timeout",
      "tag": "developer",
      "description": "Based on the investigation results, fix the root cause of the login timeout bug. Make the minimal change needed.",
      "repo": "myorg/webapp",
      "dependsOn": ["investigate-bug"],
      "requiresReview": true,
      "feedbackCommands": {
        "typecheck": "npx tsc --noEmit",
        "test": "npm test -- --grep 'auth'"
      }
    },
    {
      "taskId": "update-changelog",
      "name": "Update CHANGELOG",
      "tag": "technical-writer",
      "description": "Add an entry to CHANGELOG.md describing the bug fix. Follow the existing format (Keep a Changelog).",
      "repo": "myorg/webapp",
      "dependsOn": ["fix-bug"]
    }
  ]
}
```

**Output chain:**
- `investigate-bug` → `{ "rootCause": "Missing connection pool timeout in src/auth/db.ts:45", "details": "..." }`
- `fix-bug` → λαμβάνει το analysis ως context, κάνει τη minimal αλλαγή, τρέχει tests
- `update-changelog` → λαμβάνει context από το fix, γράφει το changelog entry

---

## Τι Παράγει Κάθε Task (Output)

Κάθε task παράγει 3 artifacts που αποθηκεύονται στο S3:

### 1. Task Result (`artifacts/task-result.json`)
Το κύριο output — αυτό που βλέπει ο χρήστης και που περνάει στα dependent tasks:
```json
{
  "filesCreated": ["src/routes/orders.ts", "src/types/order.ts"],
  "filesModified": ["src/routes/index.ts"],
  "summary": "Created paginated GET /users/:id/orders endpoint with status filter support",
  "details": "..."
}
```

### 2. Execution Log (`logs/summary.log`)
Metadata εκτέλεσης:
```
Task: implement-endpoint
Duration: 45.2s
Model: claude-opus-4-5
Turns: 18/30
Tokens: 12,000 input / 3,500 output / 8,000 cache-read
Feedback: 2 rounds (lint failed round 1, all passed round 2)
Status: completed
```

### 3. Session Trace (`traces/session_trace.json`)
Αναλυτικό trace κάθε tool call:
```json
{
  "toolCalls": [
    { "name": "Glob", "input": "src/routes/**/*.ts", "durationMs": 150 },
    { "name": "Read", "input": "src/routes/users.ts", "durationMs": 200 },
    { "name": "Write", "input": "src/routes/orders.ts", "durationMs": 300 },
    { "name": "Bash", "input": "npm test", "durationMs": 8500 }
  ],
  "cacheMetrics": {
    "inputTokens": 12000,
    "cacheReadTokens": 8000,
    "cacheEfficiency": "66.7%"
  }
}
```

### Dependency Output Passing
Όταν ένα task ολοκληρώνεται, ο Dispatcher παίρνει το `task-result.json` και το περνάει στα dependent tasks ως `dependencyOutputs`:

```
Task A output: { "colors": ["#FF0", "#00F"] }
                    ↓
Task B prompt:
  # Context from Previous Tasks
  { "task-A": { "colors": ["#FF0", "#00F"] } }
```

Αυτό επιτρέπει **chaining** — κάθε task χτίζει πάνω στη δουλειά του προηγούμενου.

---

## Prompt Construction (Τι Βλέπει ο Claude Agent)

Για κάθε task, χτίζεται ένα structured prompt:

```markdown
# Role
You are a backend-developer.

# Task
Create a new GET endpoint at /users/:id/orders that returns paginated orders...

# Input
{ "techStack": "Express + TypeScript + Prisma" }

# Context from Previous Tasks
{ "investigate-bug": { "rootCause": "Missing timeout in db.ts:45" } }

# Previous Output (Iteration 1)
{ ... }  ← μόνο αν είναι revision (iteration > 1)

# Reviewer Feedback
"Add error handling for invalid user IDs"  ← μόνο αν reviewer ζήτησε αλλαγές

# Validation
After you finish, the following commands will be run:
- lint: npm run lint
- typecheck: npx tsc --noEmit
- test: npm test
```

Τα inputs sanitize-ονται αυτόματα (αφαίρεση `{{template injection}}`, `<script>`, κτλ).

---

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌────────────────┐
│  React UI   │     │  Producer API   │     │  Health Check  │
│  (Vite)     │     │  (API Gateway)  │     │  (Scheduled)   │
└─────────────┘     └───────┬─────────┘     └────────┬───────┘
                            │                         │
                    ┌───────▼─────────────────────────▼──────┐
                    │          EventBridge Bus               │
                    └──┬──────────┬──────────────┬───────────┘
                       │          │              │
              ┌────────▼──┐  ┌───▼────────┐  ┌──▼──────────┐
              │  Event    │  │ Dispatcher │  │  DLQ Alert  │
              │  Service  │  │ (DAG orch) │  │  Service    │
              └────┬──────┘  └───┬────────┘  └─────────────┘
                   │             │
              ┌────▼──────┐  ┌──▼──────────┐
              │ DynamoDB  │  │  SQS Queue  │
              │ (events)  │  └──┬──────────┘
              └───────────┘     │
                           ┌────▼──────────┐
                           │   Consumer    │
                           │ (SQS Worker)  │
                           │ + Claude SDK  │
                           └───────────────┘
```

---

## Features

### 1. DAG Orchestration (Job & Task Management)

- **POST /jobs** — Δημιουργία job με πολλαπλά tasks και dependency graph
- **POST /jobs/{jobId}/tasks** — Προσθήκη tasks σε υπάρχον job
- **GET /jobs**, **GET /jobs/{jobId}** — Ανάγνωση jobs/tasks/status
- Validation μέσω **Kahn's algorithm** (cycle detection, max 50 tasks)
- Αυτόματο dispatch root tasks (χωρίς dependencies) αμέσως μετά τη δημιουργία
- Όταν ένα task ολοκληρώνεται, ο Dispatcher ελέγχει ποια dependent tasks είναι πλέον ready και τα ενεργοποιεί — **dependency output passing** (το output ενός task γίνεται input στα εξαρτημένα)

### 2. Claude Agent Task Execution

- Κάθε task τρέχει σε **child process** με Claude Agent SDK (Claude Opus 4.5)
- Configurable **tools** (default: Read, Edit, Write, Bash, Glob, Grep)
- Configurable **maxTurns** (default: 20, max: 200)
- Prompt building: role, task description, input data, dependency outputs, previous output, reviewer feedback, validation commands
- Timeout protection (default 120s, max 15min)
- Streaming output με retry logic

### 3. Git Worktree Isolation

- **Bare clone caching** — Κάθε repo κάνει clone μία φορά ως bare repo
- **Git worktrees** — Κάθε task παίρνει isolated working directory (`/tmp/job-manager-tasks/{taskId}`)
- **Lockfile-based concurrency** — Αποτρέπει race conditions σε concurrent clone/fetch
- **Auto-cleanup** μετά την ολοκλήρωση του task
- Branch per task: `task/{taskId}`

### 4. Feedback Loop (εμπνευσμένο από Stripe Minions)

- **Tiered validation commands** per task:
  - **Tier 1:** lint, typecheck (γρήγορα, τρέχουν πρώτα)
  - **Tier 2:** test (πιο αργό, τρέχει μόνο αν περάσει το Tier 1)
- Αν αποτύχει: re-run agent με error context (**max 2 rounds auto-fix**)
- Feedback result propagation μέσω events (passed/failed, rounds)

### 5. Review & Revision Workflow

- Tasks μπορούν να ζητούν **human review** (`requiresReview: true`)
- Μετά την ολοκλήρωση → `Task Submitted For Review` αντί `Task Completed`
- Reviewer μπορεί να κάνει approve ή request revision
- Revision: re-enqueue με iteration+1 + reviewer feedback (max 5 iterations)

### 6. Health Monitoring

- **Scheduled health checks** κάθε 5 λεπτά (prod)
- Ανίχνευση stuck/overtime tasks:
  - Healthy: < 2 min
  - Warning: 2–10 min χωρίς heartbeat
  - Overtime: > 4 ώρες
  - Critical: > 12 ώρες ή > 30 min χωρίς heartbeat
- **Slack alerts** για critical tasks
- Single-task check API

### 7. Error Handling & Resilience

- **Retryable errors** → message μένει στο SQS (max 3 retries)
- **Terminal errors** → `Task Failed`, message deleted
- **Dead Letter Queue** → dlq-processor εκπέμπει terminal failure
- **Heartbeat system** → visibility extension κάθε 20s
- **Idempotency checks** → αποφυγή duplicate processing

### 8. Event Sourcing

- **Immutable event log** στο DynamoDB (single table, 7 GSIs)
- Κάθε αλλαγή κατάστασης = νέο event
- 15+ event types: Job Saved, Task Pending, Processing Started, Heartbeat, Completed, Failed, etc.
- Πλήρης audit trail

### 9. Frontend Dashboard

- **React 19 + Vite + Tailwind CSS**
- **Kanban board** (Pending → Processing → In Review → Completed/Failed)
- Job list με summary cards
- Task cards με tag, dependencies, iteration, review status
- **Currently mock data** — δεν είναι ακόμα connected στο API

---

## Data Flow — Πλήρης Ροή Ενός Job

### Phase 1: Job Creation

```
User/API Client
    ↓
POST /jobs { tasks: [{ taskId, name, description, tag, dependsOn, ... }] }
    ↓
Producer API (create-job.js)
    ├─ Validates DAG (cycles, duplicates, max 50 tasks)
    ├─ Generates jobId = "job-{uuid}"
    ├─ Writes Job Saved event to DynamoDB
    ├─ Emits Task Saved event per task → EventBridge
    └─ Emits Task Pending event per root task → EventBridge
    ↓
EventBridge Routes Events
    ├─ Task Saved → save-event-to-dynamo Lambda → DynamoDB
    └─ Task Pending → task-enqueuer Lambda
    ↓
task-enqueuer Lambda
    ├─ Waits 1.5s for Task Saved to persist
    ├─ Queries DynamoDB for latest Task Saved
    └─ Sends SQS message to task-queue
```

### Phase 2: Task Processing

```
SQS Message
    ↓
SQS Worker (sqs-worker.cjs)
    ├─ Polls queue (20s long-poll)
    ├─ Idempotency check
    ├─ Emits Task Processing Started
    ├─ Extends visibility every 20s + Heartbeat events
    └─ Spawns child: node task-workflow.js
    ↓
Task Workflow
    ├─ Builds prompt (role + task + input + deps + feedback commands)
    ├─ Prepares git repo (worktree isolation)
    ├─ Calls Claude Agent SDK
    ├─ Runs feedback loop (lint → typecheck → test, max 2 fix rounds)
    ├─ Uploads artifacts to S3
    └─ Cleanup worktree
    ↓
Worker
    ├─ Emits Task Completed (or Task Submitted For Review)
    └─ Deletes SQS message
    ↓
Dispatcher (task-dispatcher)
    ├─ Queries Job DAG
    ├─ Finds newly ready tasks (all deps met)
    ├─ Emits Task Saved + Task Pending per ready task
    └─ If all done → Job Completed
    ↓
Repeat until all tasks complete
```

### Phase 3: Error Handling

```
Error in child process
    ├─ Retryable → Task Processing Failed → message stays in SQS (max 3 retries)
    └─ Terminal → Task Failed → message deleted
         ↓
         Dispatcher emits Job Failure Detected (non-blocking)

Message exceeds retries → DLQ → dlq-processor → Task Failed
```

---

## Event System

| Event | Emitted By | Trigger |
|-------|-----------|---------|
| `Job Saved` | Producer API | Job created or tasks added |
| `Task Saved` | Producer API, Dispatcher | Task created or outputs ready |
| `Task Pending` | Producer API, Dispatcher | Task ready to execute |
| `Task Processing Started` | Worker | Child process spawned |
| `Task Processing Failed` | Worker | Retryable error |
| `Task Completed` | Worker | Success, no review required |
| `Task Submitted For Review` | Worker | Success, review required |
| `Task Revision Requested` | Review API | Reviewer requests changes |
| `Task Approved` | Review API | Reviewer approves |
| `Task Failed` | Worker, DLQ Processor | Terminal error |
| `Task Timeout` | Worker | Timeout exceeded |
| `Task Heartbeat` | Worker | Visibility extension |
| `Job Completed` | Dispatcher | All tasks completed |
| `Job Failure Detected` | Dispatcher | Task failed (non-blocking) |
| `Task Health Check` | Health Check Lambda | Scheduled check |

---

## Database Schema (DynamoDB — Single Table)

**Table:** `events-{stage}`

**Primary Key:** `PK (HASH) + SK (RANGE)`
```
PK = "TENANT#{tenantId}"
SK = "TIMESTAMP#{timestamp}#EVENT#{eventId}"
```

**7 Global Secondary Indexes:**

| Index | PK Pattern | Use Case |
|-------|-----------|----------|
| GSI1 | `TASK#{taskId}` / `JOB#{jobId}` | All events for a task/job |
| GSI2 | `APP#{appName}` | Timeline of all app events |
| GSI3 | `APP#{appName}` + entity | App events for specific entity |
| GSI4 | `EVENT#{eventType}` | All events of a type |
| GSI5 | `EVENT#{eventType}` + entity | Event type for specific entity |
| GSI6 | `EVENT#{eventType}` + app | Event type within app |
| GSI7 | `EVENT#{eventType}` + app + entity | Narrowest query scope |

---

## Infrastructure & AWS Services

| Service | Usage |
|---------|-------|
| **Lambda** | All handlers (producer, dispatcher, health-check, event) |
| **SQS** | Task queue + Dead Letter Queue |
| **EventBridge** | Async event routing between services |
| **DynamoDB** | Event storage (single table, event-sourced) |
| **S3** | Artifact storage (logs, traces, task results) |
| **API Gateway** | HTTP endpoints with API key auth + throttling |
| **CloudWatch Events** | Scheduled health checks |

**Deployment:** Serverless Framework (serverless.yml per service)

---

## Task Configuration Options

```json
{
  "taskId": "my-task",
  "name": "Implement feature X",
  "description": "Detailed description...",
  "tag": "developer",
  "dependsOn": ["other-task"],
  "requiresReview": true,
  "repo": "https://github.com/org/repo",
  "input": { "key": "value" },
  "allowedTools": ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  "maxTurns": 20,
  "feedbackCommands": {
    "lint": "npm run lint",
    "typecheck": "npx tsc --noEmit",
    "test": "npm test"
  }
}
```

---

## Environment Variables (Consumer Worker)

| Variable | Default | Description |
|----------|---------|-------------|
| `SQS_QUEUE_URL` | — | SQS queue to poll |
| `MAX_CONCURRENT_CLAUDE` | 3 | Max concurrent child processes |
| `CLAUDE_MODEL` | claude-opus-4-5 | Claude model to use |
| `CLAUDE_TIMEOUT` | 200s | Task execution timeout |
| `DEFAULT_TIMEOUT` | 120000ms | Agent timeout |
| `MAX_MESSAGE_RETRIES` | 3 | Max SQS retries |
| `MAX_TASK_ITERATIONS` | 5 | Max revision iterations |
| `VISIBILITY_EXTENSION_INTERVAL` | 20s | Heartbeat interval |
| `GITHUB_TOKEN` | — | For private repo access |
| `WORKTREES_BASE` | /tmp/job-manager-tasks | Git worktree base path |
| `S3_BUCKET` | — | Artifact storage |

---

## Current Status

| Area | Status |
|------|--------|
| Infrastructure (SQS, DynamoDB, EventBridge, S3) | Ready to deploy |
| Producer API (CRUD endpoints) | Ready |
| Dispatcher (DAG orchestration) | Ready |
| Consumer (Claude execution + feedback loop) | Ready |
| Event persistence | Ready |
| Health checks + Slack alerts | Ready |
| Git worktree isolation | Ready |
| Feedback loop (lint/typecheck/test) | Ready |
| Review notification routing | **WIP** |
| Frontend ↔ API integration | **Not connected** (mock data) |
| Real-time monitoring dashboard | **Missing** |
| Deployment/CI pipeline | **Not defined** |

---

## Task Lifecycle State Machine

```
pending
  ↓
processing (heartbeats every 20s)
  ├─ → processing-failed (retryable) → pending (retry, max 3)
  ├─ → completed (no review) → [deps notified]
  ├─ → in_review (review required)
  │     ├─ → approved → [deps notified]
  │     └─ → revision_requested → pending (iteration++, max 5)
  ├─ → failed (terminal)
  └─ → timeout

Terminal states: completed, approved, failed, timeout
```

---

*Last updated: 2026-02-23 (enriched with use cases & examples)*
