# Task Registry

Defines the available task types that workers can execute. Each task type has a **description** (what needs to be done) and a **tag** (which role should do it).

Related docs: [consumer-architecture.md](./consumer-architecture.md), [producer-api.md](./producer-api.md)

---

## 1. Task Definition

A task definition is a named template that tells the worker **what** to do and **as whom**.

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier. Format: `/^[a-zA-Z0-9-_]{1,64}$/` |
| `description` | Yes | What needs to be done — becomes the task prompt for Claude |
| `tag` | Yes | Which role should execute — defines persona/expertise |

```javascript
{
  name: "color-tags",
  description: "Analyze the store's visual identity and generate a color palette with semantic tags (primary, secondary, accent, neutral). Include hex codes, contrast ratios, and usage recommendations.",
  tag: "designer"
}
```

### Tag = Role

The `tag` defines the persona Claude assumes when executing the task. Different tags carry different expertise and focus:

| Tag | Role | Focus |
|-----|------|-------|
| `designer` | Visual/UI designer | Colors, fonts, layout, visual identity |
| `analyst` | Data/market analyst | Competitor analysis, market research, trends |
| `scraper` | Data extraction specialist | Web scraping, structured data extraction |
| `copywriter` | Content writer | Brand copy, descriptions, messaging |
| `compiler` | Aggregation specialist | Merging outputs, final reports, synthesis |

Tags are not hardcoded — any string is valid. The table above shows common examples.

### How Description + Tag Become a Prompt

The consumer builds the prompt for Claude from the task definition + runtime input:

```javascript
// src/workflow/prompt-builder.js

function buildPrompt({ taskDefinition, input, dependencyOutputs }) {
  const sections = [
    `# Role\nYou are a ${taskDefinition.tag}.`,
    `# Task\n${taskDefinition.description}`,
  ];

  if (Object.keys(input).length > 0) {
    sections.push(`# Input\n${JSON.stringify(input, null, 2)}`);
  }

  if (dependencyOutputs && Object.keys(dependencyOutputs).length > 0) {
    sections.push(`# Context from Previous Tasks\n${JSON.stringify(dependencyOutputs, null, 2)}`);
  }

  return sections.join('\n\n');
}
```

Example assembled prompt:

```
# Role
You are a designer.

# Task
Analyze the store's visual identity and generate a color palette with semantic
tags (primary, secondary, accent, neutral). Include hex codes, contrast ratios,
and usage recommendations.

# Input
{
  "style": "modern"
}

# Context from Previous Tasks
{
  "scrape-store": {
    "storeName": "Example Store",
    "primaryColors": ["#1a1a2e", "#e94560"],
    "logoUrl": "https://..."
  }
}
```

---

## 2. Storage — DynamoDB

Task definitions live in a dedicated DynamoDB table. Simple key-value: `name` → definition.

### Table Schema

```yaml
TaskDefinitionsTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: task-definitions-${self:provider.stage}
    BillingMode: PAY_PER_REQUEST
    AttributeDefinitions:
      - AttributeName: name
        AttributeType: S
    KeySchema:
      - AttributeName: name
        KeyType: HASH
```

### Item Structure

```javascript
{
  name: "color-tags",                       // PK
  description: "Analyze the store's visual identity and generate...",
  tag: "designer",
  createdAt: 1707300000000,
  updatedAt: 1707300000000
}
```

---

## 3. Consumer — Task Lookup

When the worker receives an SQS message, it looks up the task definition by `name`:

```
SQS message arrives
  │
  │  { taskId, jobId, name: "color-tags", input: {...}, dependencyOutputs: {...} }
  │
  ▼
Worker (sqs-worker.cjs)
  │
  ├── Look up task definition: name → DynamoDB GetItem
  │     → { description, tag }
  │
  ├── Build prompt: role (tag) + task (description) + input + dependency outputs
  │
  ├── Configure Claude Agent SDK step:
  │     constructedPrompt: buildPrompt(definition, input, dependencyOutputs)
  │     maxTurns: definition.maxTurns || 10
  │     tools: definition.tools || []
  │     timeout: definition.timeout || 300000
  │
  └── Spawn child process → task-workflow.js
```

```javascript
// src/workflow/task-workflow.js — task definition lookup

import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function getTaskDefinition(name) {
  const result = await ddbClient.send(new GetCommand({
    TableName: process.env.TASK_DEFINITIONS_TABLE,
    Key: { name }
  }));

  if (!result.Item) {
    throw new Error(`Unknown task type: "${name}" — not found in task registry`);
  }

  return result.Item;
}
```

### Error: Unknown Task Type

If the `name` doesn't match any definition in the registry, the child process exits with code 1. The worker classifies this as a **non-retryable** error (validation category) → emits `Task Failed` → message deleted.

---

## 4. Producer — Task Name Validation

When the Producer API receives a `POST /jobs` request, it validates that all task `name` values exist in the registry:

```javascript
// src/handlers/create-job.js — add to validation

async function validateTaskNames(tasks) {
  const names = [...new Set(tasks.map(t => t.name))];

  const results = await Promise.all(
    names.map(name =>
      ddbClient.send(new GetCommand({
        TableName: process.env.TASK_DEFINITIONS_TABLE,
        Key: { name }
      }))
    )
  );

  const missing = names.filter((name, i) => !results[i].Item);
  if (missing.length > 0) {
    return { valid: false, errors: [`Unknown task types: ${missing.join(', ')}`] };
  }

  return { valid: true };
}
```

This prevents jobs from being created with task types that the consumer can't execute. Fail early at the API, not at execution time.

---

## 5. Management API

Task definitions are managed via the Producer API. Two additional endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/task-definitions/{name}` | Create or update a task definition |
| `GET` | `/task-definitions` | List all task definitions |

### PUT /task-definitions/{name}

```json
PUT /task-definitions/color-tags

{
  "description": "Analyze the store's visual identity and generate a color palette with semantic tags...",
  "tag": "designer"
}
```

```javascript
// src/handlers/put-task-definition.js

export async function handler(event) {
  const name = event.pathParameters.name;
  const body = JSON.parse(event.body);

  // Validate
  if (!TASK_NAME_PATTERN.test(name)) {
    return error(400, { error: `Invalid name format` });
  }
  if (!body.description || typeof body.description !== 'string') {
    return error(400, { error: 'description is required' });
  }
  if (!body.tag || typeof body.tag !== 'string') {
    return error(400, { error: 'tag is required' });
  }

  const now = Date.now();
  await ddbClient.send(new PutCommand({
    TableName: process.env.TASK_DEFINITIONS_TABLE,
    Item: {
      name,
      description: body.description,
      tag: body.tag,
      updatedAt: now,
      createdAt: now       // overwritten on update — acceptable for simplicity
    }
  }));

  return success(200, { name, description: body.description, tag: body.tag });
}
```

Response — 200 OK:

```json
{
  "name": "color-tags",
  "description": "Analyze the store's visual identity and generate...",
  "tag": "designer"
}
```

### GET /task-definitions

```javascript
// src/handlers/list-task-definitions.js

export async function handler() {
  const result = await ddbClient.send(new ScanCommand({
    TableName: process.env.TASK_DEFINITIONS_TABLE
  }));

  return success(200, {
    definitions: (result.Items || []).map(item => ({
      name: item.name,
      description: item.description,
      tag: item.tag
    }))
  });
}
```

Response — 200 OK:

```json
{
  "definitions": [
    {
      "name": "scrape-store",
      "description": "Extract product data, branding assets, color palette, and metadata from the given store URL.",
      "tag": "scraper"
    },
    {
      "name": "color-tags",
      "description": "Analyze the store's visual identity and generate a color palette with semantic tags...",
      "tag": "designer"
    },
    {
      "name": "analyze-competitors",
      "description": "Research and analyze competitor stores in the same market segment...",
      "tag": "analyst"
    },
    {
      "name": "font-pairing",
      "description": "Based on the store's visual identity, recommend 2-3 font pairings with usage guidelines...",
      "tag": "designer"
    },
    {
      "name": "compile-result",
      "description": "Aggregate all task outputs into a final comprehensive brand analysis report.",
      "tag": "compiler"
    }
  ]
}
```

---

## 6. Serverless Configuration (additions to producer-api)

```yaml
# Add to producer-api/serverless.yml

provider:
  environment:
    TASK_DEFINITIONS_TABLE: !Ref TaskDefinitionsTable    # add to existing env

functions:
  # ... existing functions (create-job, add-tasks, list-jobs, get-job)

  put-task-definition:
    handler: src/handlers/put-task-definition.handler
    description: Create or update a task definition
    timeout: 10
    memorySize: 256
    events:
      - http:
          path: /task-definitions/{name}
          method: put
          private: true
    iamRoleStatements:
      - Effect: Allow
        Action:
          - dynamodb:PutItem
        Resource: !GetAtt TaskDefinitionsTable.Arn

  list-task-definitions:
    handler: src/handlers/list-task-definitions.handler
    description: List all task definitions
    timeout: 10
    memorySize: 256
    events:
      - http:
          path: /task-definitions
          method: get
          private: true
    iamRoleStatements:
      - Effect: Allow
        Action:
          - dynamodb:Scan
        Resource: !GetAtt TaskDefinitionsTable.Arn

  # Update existing create-job and add-tasks with GetItem permission:
  create-job:
    iamRoleStatements:
      # ... existing permissions
      - Effect: Allow
        Action:
          - dynamodb:GetItem
        Resource: !GetAtt TaskDefinitionsTable.Arn

  add-tasks:
    iamRoleStatements:
      # ... existing permissions
      - Effect: Allow
        Action:
          - dynamodb:GetItem
        Resource: !GetAtt TaskDefinitionsTable.Arn

resources:
  Resources:
    TaskDefinitionsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: task-definitions-${self:provider.stage}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: name
            AttributeType: S
        KeySchema:
          - AttributeName: name
            KeyType: HASH

  Outputs:
    TaskDefinitionsTableName:
      Value: !Ref TaskDefinitionsTable
      Export:
        Name: task-definitions-table-name-${self:provider.stage}
    TaskDefinitionsTableArn:
      Value: !GetAtt TaskDefinitionsTable.Arn
      Export:
        Name: task-definitions-table-arn-${self:provider.stage}
```

---

## 7. Architecture Summary

```
                          ┌─────────────────────────────┐
                          │  PUT /task-definitions/{name}│
                          │  GET /task-definitions       │
                          └──────────────┬──────────────┘
                                         │ CRUD
                                         ▼
                          ┌─────────────────────────────┐
                          │  DynamoDB                     │
                          │  task-definitions-{stage}     │
                          │                               │
                          │  name (PK) │ description │ tag│
                          │  ──────────┼─────────────┼────│
                          │  color-tags│ Analyze...  │ des│
                          │  scrape... │ Extract...  │ scr│
                          └───────┬─────────────┬─────────┘
                                  │             │
                   Validate names │             │ Lookup at execution
                   at job creation│             │
                                  ▼             ▼
                          ┌────────────┐ ┌─────────────────┐
                          │ Producer   │ │ Consumer (PM2)   │
                          │ API        │ │                   │
                          │            │ │ 1. GetItem(name)  │
                          │ POST /jobs │ │ 2. Build prompt:  │
                          │ validates  │ │    Role: {tag}    │
                          │ task names │ │    Task: {desc}   │
                          │ exist      │ │    Input: {...}   │
                          └────────────┘ │ 3. Execute Claude │
                                         └─────────────────┘
```

---

## 8. Consumer Environment Update

The PM2 consumer needs the table name to look up definitions:

| Variable | Value | Used By |
|----------|-------|---------|
| `TASK_DEFINITIONS_TABLE` | `task-definitions-{stage}` | task-workflow.js |

Add to `ecosystem.config.cjs` env and to the allowlisted variables in sqs-worker.cjs ([consumer-architecture.md](./consumer-architecture.md) §1 — Secure Environment Filtering, App category).
