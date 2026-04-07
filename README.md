# Job Manager

A general-purpose **AI task execution engine** built on AWS. Define tasks in natural language, wire them as a DAG, and let Claude agents execute them autonomously with feedback loops, human review, and output chaining.

## How It Works

1. You submit a **job** — a set of tasks with dependencies between them (DAG)
2. The system dispatches tasks in dependency order via SQS
3. Each task runs in a **Claude Agent** (via Claude Agent SDK) with configurable tools, model, and timeout
4. Task outputs chain into dependent tasks as context
5. Optional: feedback loop (lint/typecheck/test) auto-fixes failures, human review gates

Tasks can do **anything** — code changes on repos, data analysis, report generation, scraping. The `repo` field is optional; without it the agent runs without git context.

## Architecture

```
React UI  <-->  Producer API (API Gateway, 7 endpoints)
                       |
                  EventBridge
                 /     |      \
          Event     Dispatcher    DLQ Alerts
          Service   (3 Lambdas)
            |           |
         DynamoDB    SQS Queue
                        |
                   Consumer (PM2, 3 instances)
                   Claude Agent SDK per task
```

- **Lambda services:** Producer API, Dispatcher, Event Service, Health Check
- **Consumer:** Long-running PM2 process on EC2 (not Lambda)
- **Storage:** DynamoDB (events), S3 (artifacts)

## Project Structure

```
job-manager/
  config/
    config.dev.yml                 # Dev stage config (AWS profile, Slack)
    config.prod.yml                # Prod stage config
  deploy.sh                        # Deploy all Lambda services
  job-manager-ui/                  # React 19 + Vite + Tailwind dashboard
  services/
    infrastructure/                # SQS, DynamoDB, EventBridge, S3
    business-services/
      producer-api/                # 7 Lambda handlers (CRUD + review)
      dispatcher/                  # task-dispatcher, task-enqueuer, review-notifier
      event/                       # save-event-to-dynamo, dlq-processor, eb-dlq-alert
      health-check/                # Scheduled + single-task health checks
      consumer/                    # PM2 SQS worker + Claude Agent SDK
```

## Prerequisites

- Node.js 22+
- AWS CLI configured (profile `default` for dev)
- [Serverless Framework](https://www.serverless.com/) v4
- PM2 (`npm install -g pm2`)
- Anthropic API key or Claude OAuth token

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure AWS profile

Each stage uses an AWS profile defined in `config/config.{stage}.yml`:

```yaml
# config/config.dev.yml
profile: default

# config/config.prod.yml
profile: prod
```

Change `profile` to match your AWS CLI profile name (from `~/.aws/credentials`).

### 3. Deploy infrastructure + Lambda services

```bash
./deploy.sh          # deploys dev stage (uses profile from config.dev.yml)
./deploy.sh prod     # deploys prod stage (uses profile from config.prod.yml)
```

This deploys (in order):
1. Infrastructure (SQS, DynamoDB, EventBridge, S3)
2. Business services in parallel (Producer API, Dispatcher, Event Service, Health Check)

### 4. Start the Consumer (SQS worker)

```bash
cd services/business-services/consumer
```

Create a `.env` file:

```env
SQS_QUEUE_URL=https://sqs.eu-west-1.amazonaws.com/<account-id>/task-queue-dev
S3_BUCKET=job-manager-artifacts-dev-<account-id>
DYNAMODB_EVENTS_TABLE_NAME=events-dev
EVENTBRIDGE_BUS_NAME=job-manager-dev
TENANT_ID=gbInnovations
APP_NAME=task-workflow
ANTHROPIC_API_KEY=sk-ant-...
# or: CLAUDE_CODE_OAUTH_TOKEN=...
# optional: GITHUB_TOKEN=ghp_... (for private repos)
```

Start with PM2:

```bash
pm2 start ecosystem.config.cjs
```

### 5. Start the UI (optional)

```bash
cd job-manager-ui
```

Create a `.env` file:

```env
VITE_API_URL=https://<api-id>.execute-api.eu-west-1.amazonaws.com/dev
VITE_API_KEY=<your-api-key>
```

```bash
npm run dev
```

Without `VITE_API_URL`, the UI falls back to mock data.

## API

Base URL: `https://<api-id>.execute-api.eu-west-1.amazonaws.com/dev`

All endpoints require `x-api-key` header.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/jobs` | Create a job with task DAG |
| POST | `/jobs/{jobId}/tasks` | Add tasks to existing job |
| GET | `/jobs` | List all jobs |
| GET | `/jobs/{jobId}` | Get job details with task statuses |
| GET | `/jobs/{jobId}/tasks/{taskId}/events` | Task event timeline |
| POST | `/jobs/{jobId}/tasks/{taskId}/approve` | Approve a task in review |
| POST | `/jobs/{jobId}/tasks/{taskId}/request-revision` | Request revision with feedback |

## Creating a Job

```bash
curl -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "analyze",
        "name": "Analyze codebase",
        "tag": "developer",
        "description": "Read the src/ directory and identify all API endpoints. Return a JSON array of { method, path, handler }.",
        "repo": "myorg/backend",
        "model": "claude-sonnet-4-6",
        "maxTurns": 15
      },
      {
        "taskId": "write-docs",
        "name": "Generate API docs",
        "tag": "technical-writer",
        "description": "Using the endpoint list from the previous task, generate OpenAPI documentation in YAML format.",
        "dependsOn": ["analyze"],
        "model": "claude-haiku-4-5",
        "maxTurns": 10
      }
    ]
  }'
```

## Task Configuration

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `taskId` | yes | string | Unique ID (alphanumeric, hyphens, underscores, max 128 chars) |
| `name` | yes | string | Human-readable task name |
| `description` | yes | string | Natural language instructions for the Claude agent |
| `tag` | yes | string | Agent role (e.g. `developer`, `data-analyst`, `technical-writer`) |
| `dependsOn` | no | string[] | Task IDs this task depends on (default: `[]`) |
| `model` | no | string | Claude model to use (default: `claude-sonnet-4-6`) |
| `repo` | no | string | GitHub repo (`org/repo` or full URL). Omit for non-repo tasks |
| `input` | no | object | Arbitrary key-value data passed to the agent as context |
| `allowedTools` | no | string[] | Tools the agent can use (default: `Read, Edit, Write, Bash, Glob, Grep`) |
| `maxTurns` | no | integer | Max agent turns, 1-200 (default: 20) |
| `requiresReview` | no | boolean | Require human approval before dependents run (default: `false`) |
| `feedbackCommands` | no | object | Validation commands to auto-run after agent completes |

### Model Selection

Per-task model choice. Use expensive models for complex tasks, cheaper ones for simple tasks.

| Model | Best for |
|-------|----------|
| `claude-opus-4-6` | Complex coding, architecture decisions, multi-file refactoring |
| `claude-sonnet-4-6` | General-purpose tasks, balanced cost/quality (default) |
| `claude-sonnet-4-5` | Previous-gen general purpose |
| `claude-opus-4-5` | Previous-gen complex tasks |
| `claude-haiku-4-5` | Fast/cheap — classification, simple formatting, summaries |

Precedence: task `model` field > `CLAUDE_MODEL` env var > `claude-sonnet-4-6`

### Repo Tasks vs General-Purpose Tasks

**With `repo`:**
- Agent gets an isolated git worktree at `/tmp/job-manager-tasks/{taskId}`
- Works on branch `task/{taskId}`
- Feedback loop runs (lint/typecheck/test if configured)
- Worktree is cleaned up after completion

**Without `repo`:**
- Agent runs in the consumer's working directory
- No git operations
- Feedback loop is skipped (even if `feedbackCommands` is set)
- Good for: data analysis, scraping, report generation, any non-code task

### Feedback Commands

Auto-validation after the agent finishes. Runs in 2 tiers:

```json
"feedbackCommands": {
  "lint": "npm run lint",
  "typecheck": "npx tsc --noEmit",
  "test": "npm test"
}
```

- **Tier 1** (fast): `lint`, `typecheck` — run first
- **Tier 2** (slow): `test` — only if Tier 1 passes
- If a command fails, the agent re-runs with the error output (max 2 auto-fix rounds)
- Only works with repo tasks

### Review Workflow

Set `requiresReview: true` to require human approval:

1. Agent completes work -> status becomes `in_review`
2. Reviewer inspects output in dashboard or via API
3. **Approve** -> dependent tasks are dispatched
4. **Request revision** -> agent re-runs with reviewer feedback (max 5 iterations)

### Output Chaining

When a task completes, its output is passed to dependent tasks as context:

```
Task A output: { "endpoints": ["/users", "/orders"] }
                    |
Task B receives:
  # Context from Previous Tasks
  { "task-a": { "endpoints": ["/users", "/orders"] } }
```

## Examples

All examples are `POST /jobs` request bodies. Each job contains a `tasks` array.

### Simple task execution (the basics)

The simplest use case: two tasks with a dependency. The first generates a fibonacci sequence, the second analyzes it. No repo, no external APIs — just Claude executing instructions.

```json
{
  "tasks": [
    {
      "taskId": "generate-data",
      "name": "Generate fibonacci sequence",
      "tag": "developer",
      "description": "Write a script that generates the first 50 fibonacci numbers. Return the result as a JSON array.",
      "allowedTools": ["Bash", "Write"],
      "maxTurns": 10
    },
    {
      "taskId": "analyze-data",
      "name": "Analyze the sequence",
      "tag": "data-analyst",
      "description": "Analyze the fibonacci sequence from the previous task. Calculate the golden ratio convergence, identify which numbers are prime, and return a structured JSON summary.",
      "dependsOn": ["generate-data"],
      "maxTurns": 10
    }
  ]
}
```

**What happens:**
1. `generate-data` runs immediately (root task, no dependencies)
2. Claude writes and runs a script, outputs the fibonacci array
3. `analyze-data` receives that output as context and runs its analysis
4. Job completes when both tasks finish

### Code task (with repo + feedback + review)

```json
{
  "tasks": [
    {
      "taskId": "implement-feature",
      "name": "Add pagination to /users endpoint",
      "tag": "backend-developer",
      "description": "Add cursor-based pagination to GET /users. Follow existing patterns in src/routes/.",
      "repo": "myorg/api",
      "model": "claude-opus-4-6",
      "maxTurns": 30,
      "requiresReview": true,
      "feedbackCommands": {
        "lint": "npm run lint",
        "typecheck": "npx tsc --noEmit",
        "test": "npm test"
      }
    }
  ]
}
```

### Multi-task pipeline (with output chaining)

```json
{
  "tasks": [
    {
      "taskId": "scrape",
      "name": "Fetch product data",
      "tag": "data-engineer",
      "description": "Fetch all products from the API and return as JSON array.",
      "model": "claude-haiku-4-5",
      "input": { "apiUrl": "https://api.example.com/products" },
      "allowedTools": ["Bash", "Write"]
    },
    {
      "taskId": "analyze",
      "name": "Price analysis",
      "tag": "data-analyst",
      "description": "Analyze pricing patterns from the product data. Calculate stats per category.",
      "dependsOn": ["scrape"],
      "model": "claude-sonnet-4-6"
    },
    {
      "taskId": "report",
      "name": "Generate report",
      "tag": "technical-writer",
      "description": "Create a markdown report with tables and insights from the analysis.",
      "dependsOn": ["analyze"],
      "model": "claude-haiku-4-5",
      "allowedTools": ["Write"]
    }
  ]
}
```

## Environment Variables (Consumer)

| Variable | Default | Description |
|----------|---------|-------------|
| `SQS_QUEUE_URL` | - | SQS queue to poll |
| `S3_BUCKET` | - | Artifact storage bucket |
| `DYNAMODB_EVENTS_TABLE_NAME` | - | DynamoDB events table |
| `EVENTBRIDGE_BUS_NAME` | - | EventBridge bus name |
| `TENANT_ID` | - | Multi-tenant ID |
| `APP_NAME` | - | Application name for events |
| `ANTHROPIC_API_KEY` | - | Anthropic API key |
| `CLAUDE_CODE_OAUTH_TOKEN` | - | OAuth token (alternative to API key) |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Default model (overridden per-task) |
| `CLAUDE_TIMEOUT` | `600000` | Worker-level task timeout in ms |
| `DEFAULT_TIMEOUT` | `600000` | Agent SDK timeout in ms |
| `MAX_CONCURRENT_CLAUDE` | `3` | Max concurrent task processes |
| `GITHUB_TOKEN` | - | For private repo access |
| `WORKTREES_BASE` | `/tmp/job-manager-tasks` | Git worktree base path |
