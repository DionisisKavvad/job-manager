# Service Architecture

6 services. 5 Serverless Framework stacks deployed to AWS + 1 local PM2 consumer.

Spec docs: [consumer-architecture.md](../consumer-architecture.md), [event-system.md](../event-system.md), [producer-api.md](../producer-api.md), [job-orchestration.md](../job-orchestration.md), [health-check.md](../health-check.md), [task-registry.md](../task-registry.md)

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AWS Account                                          │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  1. INFRASTRUCTURE (Serverless — resources only, no functions)       │   │
│  │                                                                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌─────┐ ┌─────────────┐  │   │
│  │  │ SQS Queue│ │ SQS DLQ  │ │ DynamoDB   │ │ S3  │ │ EventBridge │  │   │
│  │  │          │ │          │ │ Events     │ │     │ │ Bus         │  │   │
│  │  └──────────┘ └──────────┘ │ TaskDefs   │ └─────┘ └─────────────┘  │   │
│  │                            └────────────┘                           │   │
│  │  Exports: QueueUrl, QueueArn, DLQArn, EventsTableName,             │   │
│  │           EventsTableArn, TaskDefsTableName, TaskDefsTableArn,      │   │
│  │           EventBusName, S3BucketName, S3BucketArn                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│       ▲              ▲              ▲              ▲              ▲         │
│       │              │              │              │              │         │
│  ┌────┴────┐   ┌─────┴────┐  ┌─────┴─────┐  ┌────┴─────┐       │         │
│  │ 2.EVENT │   │3.PRODUCER│  │4.DISPATCHER│  │5.HEALTH  │       │         │
│  │         │   │   API    │  │            │  │  CHECK   │       │         │
│  │ save-   │   │         │  │ task-      │  │ health-  │       │         │
│  │ event-  │   │ API GW  │  │ dispatcher │  │ check    │       │         │
│  │ to-     │   │ +6 Λ    │  │ Lambda     │  │ Lambda   │       │         │
│  │ dynamo  │   │         │  │            │  │ (sched.) │       │         │
│  │ Lambda  │   └─────────┘  └────────────┘  └──────────┘       │         │
│  │         │                                                     │         │
│  │ dlq-    │                                                     │         │
│  │ process.│                                                     │         │
│  │ Lambda  │                                                     │         │
│  │         │                                                     │         │
│  │ eb-dlq- │                                                     │         │
│  │ alert   │                                                     │         │
│  │ Lambda  │                                                     │         │
│  └─────────┘                                                     │         │
│                                                                   │         │
└───────────────────────────────────────────────────────────────────┘         │
                                                                     │        │
                                                              ┌──────┴───────┐│
                                                              │ 6. CONSUMER  ││
                                                              │ (Local/PM2)  ││
                                                              │              ││
                                                              │ sqs-worker   ││
                                                              │ task-workflow ││
                                                              └──────────────┘│
```

---

## Deploy Order

Strict order — each service depends on the one above it:

```
1. infrastructure    ← must be first (exports resources)
2. event             ← needs EventBridge Bus, DynamoDB, SQS DLQ
3. producer-api      ← needs SQS Queue, EventBridge Bus, DynamoDB, TaskDefs table
4. dispatcher        ← needs SQS Queue, EventBridge Bus, DynamoDB
5. health-check      ← needs EventBridge Bus, DynamoDB
6. consumer          ← needs SQS Queue URL, TaskDefs table (env vars)
```

Services 2–5 all depend only on infrastructure (no cross-dependencies between them) and can be deployed in parallel after infrastructure is ready.

```bash
# Full deploy
cd services/infrastructure/job-manager-infrastructure && npx serverless deploy --stage dev
# Then in parallel:
cd services/business-services/event && npx serverless deploy --stage dev &
cd services/business-services/producer-api && npx serverless deploy --stage dev &
cd services/business-services/dispatcher && npx serverless deploy --stage dev &
cd services/business-services/health-check && npx serverless deploy --stage dev &
wait
# Then start consumer:
cd services/business-services/consumer && pm2 start ecosystem.config.cjs
```

---

## Monorepo Structure

Follows the standard serverless monorepo convention: independent microservices under `services/`, each with its own `package.json` and `serverless.yml`.

```
job-manager/
├── package.json                         # Root npm config (workspaces)
├── package-lock.json
├── buildspec.yml                        # AWS CodeBuild specification
├── .gitignore
├── README.md
│
├── config/                              # Environment-specific configuration
│   ├── config.dev.yml                   # Slack tokens, AWS profiles, feature flags
│   └── config.prod.yml
│
├── docs/                                # Project documentation
│   └── architecture/
│       ├── consumer-architecture.md
│       ├── event-system.md
│       ├── producer-api.md
│       ├── job-orchestration.md
│       ├── health-check.md
│       ├── task-registry.md
│       └── open-issues.md
│
└── services/
    │
    ├── infrastructure/                  # Infrastructure as Code (resources only)
    │   └── job-manager-infrastructure/
    │       ├── package.json
    │       └── serverless.yml           # SQS, DLQ, DynamoDB x2, EventBridge, S3
    │
    ├── ci-cd/                           # CI/CD pipeline service
    │   ├── package.json
    │   └── serverless.yml               # CodeBuild, CodePipeline
    │
    └── business-services/               # All business logic services
        │
        ├── shared/                      # Shared code & dependencies across services
        │   └── node_modules/
        │
        ├── event/                       # Event persistence pipeline
        │   ├── package.json
        │   ├── serverless.yml
        │   └── src/
        │       ├── event-persistence/
        │       │   └── save-event-to-dynamo.js    # EventBridge → DynamoDB (PutItem)
        │       ├── dlq-handling/
        │       │   ├── dlq-processor.js            # SQS DLQ → emits "Task Failed"
        │       │   └── eventbridge-dlq-alert.js    # EventBridge DLQ → Slack alert
        │       └── utils/
        │           └── event-helpers.js
        │
        ├── producer-api/                # API Gateway + job/task management
        │   ├── package.json
        │   ├── serverless.yml
        │   └── src/
        │       ├── jobs/
        │       │   ├── create-job.js               # POST /jobs
        │       │   ├── add-tasks.js                # POST /jobs/{jobId}/tasks
        │       │   ├── list-jobs.js                # GET /jobs
        │       │   └── get-job.js                  # GET /jobs/{jobId}
        │       ├── task-definitions/
        │       │   ├── put-task-definition.js      # PUT /task-definitions/{name}
        │       │   └── list-task-definitions.js    # GET /task-definitions
        │       ├── services/
        │       │   ├── dag-validator.js             # Topological sort + validation
        │       │   └── event-builder.js             # GSI key computation
        │       └── utils/
        │           ├── job-queries.js               # DynamoDB query helpers
        │           ├── response.js                  # API response formatting
        │           └── config.js
        │
        ├── dispatcher/                  # DAG orchestration
        │   ├── package.json
        │   ├── serverless.yml
        │   └── src/
        │       ├── orchestration/
        │       │   └── task-dispatcher.js          # EventBridge → enqueue ready tasks
        │       └── utils/
        │           └── dag-queries.js
        │
        ├── health-check/               # Task monitoring + Slack alerts
        │   ├── package.json
        │   ├── serverless.yml
        │   └── src/
        │       ├── monitoring/
        │       │   └── health-check.js             # Scheduled + on-demand Lambda
        │       ├── services/
        │       │   ├── health-classifier.js        # healthy/warning/critical/overtime
        │       │   └── slack-alerting.js           # Slack bot alerts
        │       └── utils/
        │           └── task-queries.js             # DynamoDB query helpers
        │
        └── consumer/                    # Local PM2 worker (NOT serverless)
            ├── package.json
            ├── ecosystem.config.cjs     # PM2 config (3 instances, cluster mode)
            ├── .env                     # Local env vars (SQS URL, AWS creds, etc.)
            └── src/
                ├── worker/
                │   └── sqs-worker.cjs              # SQS polling, spawn, events (CJS)
                ├── workflow/
                │   ├── task-workflow.js             # Child process entry point (ESM)
                │   ├── agent-workflow.js            # Claude Agent SDK wrapper
                │   ├── prompt-builder.js            # Role + Tag + Input → prompt
                │   ├── prompt-template.js           # Placeholder replacement
                │   ├── workflow-logger.js           # File-based logging
                │   ├── summary-builder.js           # Execution summary
                │   └── sdk-hooks-manager.js         # SDK observability hooks
                ├── services/
                │   └── event-emitter-service.js     # EventBridge emission (ESM)
                ├── security/
                │   ├── input-sanitizer.js
                │   ├── error-sanitizer.js
                │   └── index.js
                └── utils/
                    ├── error-classifier.js          # Unified error classification
                    ├── retry.js                     # withRetry — exponential backoff
                    ├── aws-credentials.js           # AWS credentials (ESM)
                    ├── aws-credentials.cjs          # AWS credentials (CJS)
                    └── format.js                    # Output formatting
```

### Key Conventions

1. **Each service is independently deployable** — own `package.json` + `serverless.yml`
2. **Handlers grouped by feature** — `src/<feature-group>/` (e.g. `jobs/`, `monitoring/`)
3. **One Lambda per file** — each `.js` exports one handler
4. **Business logic in `src/services/`** — separated from handler boilerplate
5. **Utilities in `src/utils/`** — per-service helpers
6. **Infrastructure is separate** — AWS resources in `services/infrastructure/`, not in business services
7. **Config is environment-driven** — `config/config.{stage}.yml` referenced via `${file(...)}`
8. **Shared code** — common dependencies in `services/business-services/shared/`
9. **Consumer is the only non-serverless service** — runs locally via PM2, no `serverless.yml`

---

## 1. Infrastructure Service

Resources only — no Lambda functions. All other services import from here.

### `services/infrastructure/job-manager-infrastructure/serverless.yml`

```yaml
service: job-manager-infra

provider:
  name: aws
  stage: ${opt:stage, 'dev'}
  region: ${opt:region, 'eu-west-1'}
  profile: ${self:custom.resources.profile, 'default'}
  stackTags:
    Team: job-manager-${self:provider.stage}

custom:
  resources: ${file(../../../config/config.${self:provider.stage}.yml)}

resources:
  Resources:

    # ── SQS ──────────────────────────────────────────────

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

    # ── EventBridge ──────────────────────────────────────

    EventBus:
      Type: AWS::Events::EventBus
      Properties:
        Name: job-manager-${self:provider.stage}

    # ── DynamoDB — Events Table ──────────────────────────

    EventsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: events-${self:provider.stage}
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

    # ── DynamoDB — Task Definitions Table ────────────────

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

    # ── S3 ───────────────────────────────────────────────

    ArtifactsBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: job-manager-artifacts-${self:provider.stage}

  # ── Exports ──────────────────────────────────────────

  Outputs:
    TaskQueueUrl:
      Value: !Ref TaskQueue
      Export:
        Name: job-manager-queue-url-${self:provider.stage}
    TaskQueueArn:
      Value: !GetAtt TaskQueue.Arn
      Export:
        Name: job-manager-queue-arn-${self:provider.stage}
    TaskDLQUrl:
      Value: !Ref TaskDLQ
      Export:
        Name: job-manager-dlq-url-${self:provider.stage}
    TaskDLQArn:
      Value: !GetAtt TaskDLQ.Arn
      Export:
        Name: job-manager-dlq-arn-${self:provider.stage}
    EventsTableName:
      Value: !Ref EventsTable
      Export:
        Name: job-manager-events-table-name-${self:provider.stage}
    EventsTableArn:
      Value: !GetAtt EventsTable.Arn
      Export:
        Name: job-manager-events-table-arn-${self:provider.stage}
    TaskDefinitionsTableName:
      Value: !Ref TaskDefinitionsTable
      Export:
        Name: job-manager-task-defs-table-name-${self:provider.stage}
    TaskDefinitionsTableArn:
      Value: !GetAtt TaskDefinitionsTable.Arn
      Export:
        Name: job-manager-task-defs-table-arn-${self:provider.stage}
    EventBusName:
      Value: !Ref EventBus
      Export:
        Name: job-manager-event-bus-name-${self:provider.stage}
    EventBusArn:
      Value: !GetAtt EventBus.Arn
      Export:
        Name: job-manager-event-bus-arn-${self:provider.stage}
    ArtifactsBucketName:
      Value: !Ref ArtifactsBucket
      Export:
        Name: job-manager-artifacts-bucket-${self:provider.stage}
    ArtifactsBucketArn:
      Value: !GetAtt ArtifactsBucket.Arn
      Export:
        Name: job-manager-artifacts-bucket-arn-${self:provider.stage}
```

---

## 2. Event Service

Event persistence pipeline: EventBridge → Lambda → DynamoDB. Plus DLQ handling.

**3 Lambdas**:
- `save-event-to-dynamo` — PutItem for every event (triggered by EventBridge rule)
- `dlq-processor` — Emits terminal `Task Failed` for messages that exhausted SQS retries
- `eventbridge-dlq-alert` — Slack alert when EventBridge fails to deliver events

### `services/business-services/event/serverless.yml`

```yaml
service: job-manager-event

build:
  esbuild: true

custom:
  resources: ${file(../../../config/config.${self:provider.stage}.yml)}
  imports:
    eventsTableName: !ImportValue job-manager-events-table-name-${self:provider.stage}
    eventsTableArn: !ImportValue job-manager-events-table-arn-${self:provider.stage}
    eventBusName: !ImportValue job-manager-event-bus-name-${self:provider.stage}
    eventBusArn: !ImportValue job-manager-event-bus-arn-${self:provider.stage}
    dlqArn: !ImportValue job-manager-dlq-arn-${self:provider.stage}

provider:
  name: aws
  runtime: nodejs22.x
  stage: ${opt:stage, 'dev'}
  region: ${opt:region, 'eu-west-1'}
  profile: ${self:custom.resources.profile, 'default'}
  stackTags:
    Team: job-manager-event-${self:provider.stage}
  environment:
    ENVIRONMENT: ${self:provider.stage}
    EVENTS_TABLE: ${self:custom.imports.eventsTableName}
    EVENT_BUS_NAME: ${self:custom.imports.eventBusName}

functions:

  save-event-to-dynamo:
    handler: src/save-event-to-dynamo.handler
    description: Persists all events from EventBridge to DynamoDB
    timeout: 30
    memorySize: 256
    iamRoleStatements:
      - Effect: Allow
        Action:
          - dynamodb:PutItem
        Resource: ${self:custom.imports.eventsTableArn}

  dlq-processor:
    handler: src/dlq-processor.handler
    description: Emits terminal Task Failed for DLQ messages
    timeout: 30
    memorySize: 256
    events:
      - sqs:
          arn: ${self:custom.imports.dlqArn}
          batchSize: 1
    iamRoleStatements:
      - Effect: Allow
        Action:
          - events:PutEvents
        Resource: "*"

  eventbridge-dlq-alert:
    handler: src/eventbridge-dlq-alert.handler
    description: Slack alert when EventBridge fails to deliver events
    timeout: 30
    memorySize: 256
    environment:
      SLACK_WEBHOOK_URL: ${self:custom.resources.slackWebhookUrl}
    events:
      - sqs:
          arn: !GetAtt EventBridgeTargetDLQ.Arn
          batchSize: 1

resources:
  Resources:

    # EventBridge Rule — catches all "log-event" detail-type
    SaveEventRule:
      Type: AWS::Events::Rule
      Properties:
        Name: ${self:provider.stage}-save-event-to-dynamo
        EventBusName: ${self:custom.imports.eventBusName}
        EventPattern:
          detail-type:
            - "log-event"
        Targets:
          - Arn: !GetAtt SaveDasheventDashtoDashdynamoLambdaFunction.Arn
            Id: save-event-target
            DeadLetterConfig:
              Arn: !GetAtt EventBridgeTargetDLQ.Arn
            RetryPolicy:
              MaximumRetryAttempts: 3
              MaximumEventAgeInSeconds: 3600

    SaveEventPermission:
      Type: AWS::Lambda::Permission
      Properties:
        FunctionName: !Ref SaveDasheventDashtoDashdynamoLambdaFunction
        Action: lambda:InvokeFunction
        Principal: events.amazonaws.com
        SourceArn: !GetAtt SaveEventRule.Arn

    # EventBridge target DLQ (when Lambda delivery fails)
    EventBridgeTargetDLQ:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: ${self:provider.stage}-eventbridge-target-dlq
        MessageRetentionPeriod: 1209600   # 14 days

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
```

### Key Files

```javascript
// src/save-event-to-dynamo.js
// Spec: event-system.md § Event Persistence
export async function handler(event) {
  const detail = event.detail;
  const item = { ...detail, receivedAt: Date.now() };
  await ddbClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}
```

```javascript
// src/dlq-processor.js
// Spec: consumer-architecture.md § DLQ Processing Lambda
// Emits "Task Failed" with source: "dlq" for messages that exhausted retries
```

```javascript
// src/eventbridge-dlq-alert.js
// Spec: event-system.md § EventBridge Target DLQ — Slack Alert Lambda
// Sends Slack webhook alert for failed EventBridge deliveries
```

---

## 3. Producer API Service

API Gateway (REST) + Lambda proxy. Entry point for job/task management.

**6 Lambdas**:
- `create-job` — POST /jobs
- `add-tasks` — POST /jobs/{jobId}/tasks
- `list-jobs` — GET /jobs
- `get-job` — GET /jobs/{jobId}
- `put-task-definition` — PUT /task-definitions/{name}
- `list-task-definitions` — GET /task-definitions

### `services/business-services/producer-api/serverless.yml`

```yaml
service: job-manager-producer

build:
  esbuild: true

custom:
  resources: ${file(../../../config/config.${self:provider.stage}.yml)}
  imports:
    queueUrl: !ImportValue job-manager-queue-url-${self:provider.stage}
    queueArn: !ImportValue job-manager-queue-arn-${self:provider.stage}
    eventsTableName: !ImportValue job-manager-events-table-name-${self:provider.stage}
    eventsTableArn: !ImportValue job-manager-events-table-arn-${self:provider.stage}
    taskDefsTableName: !ImportValue job-manager-task-defs-table-name-${self:provider.stage}
    taskDefsTableArn: !ImportValue job-manager-task-defs-table-arn-${self:provider.stage}
    eventBusName: !ImportValue job-manager-event-bus-name-${self:provider.stage}

provider:
  name: aws
  runtime: nodejs22.x
  stage: ${opt:stage, 'dev'}
  region: ${opt:region, 'eu-west-1'}
  profile: ${self:custom.resources.profile, 'default'}
  stackTags:
    Team: job-manager-producer-${self:provider.stage}
  environment:
    ENVIRONMENT: ${self:provider.stage}
    TASK_QUEUE_URL: ${self:custom.imports.queueUrl}
    EVENTS_TABLE: ${self:custom.imports.eventsTableName}
    TASK_DEFINITIONS_TABLE: ${self:custom.imports.taskDefsTableName}
    EVENT_BUS_NAME: ${self:custom.imports.eventBusName}
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
        Action: sqs:SendMessage
        Resource: ${self:custom.imports.queueArn}
      - Effect: Allow
        Action: events:PutEvents
        Resource: "*"
      - Effect: Allow
        Action: dynamodb:GetItem
        Resource: ${self:custom.imports.taskDefsTableArn}

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
        Action: dynamodb:Query
        Resource:
          - ${self:custom.imports.eventsTableArn}
          - ${self:custom.imports.eventsTableArn}/index/*
      - Effect: Allow
        Action: sqs:SendMessage
        Resource: ${self:custom.imports.queueArn}
      - Effect: Allow
        Action: events:PutEvents
        Resource: "*"
      - Effect: Allow
        Action: dynamodb:GetItem
        Resource: ${self:custom.imports.taskDefsTableArn}

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
        Action: dynamodb:Query
        Resource:
          - ${self:custom.imports.eventsTableArn}
          - ${self:custom.imports.eventsTableArn}/index/*

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
        Action: dynamodb:Query
        Resource:
          - ${self:custom.imports.eventsTableArn}
          - ${self:custom.imports.eventsTableArn}/index/*

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
        Action: dynamodb:PutItem
        Resource: ${self:custom.imports.taskDefsTableArn}

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
        Action: dynamodb:Scan
        Resource: ${self:custom.imports.taskDefsTableArn}
```

Full handler logic: [producer-api.md](../producer-api.md), [task-registry.md](../task-registry.md)

---

## 4. Dispatcher Service

Single Lambda triggered by EventBridge on `Task Completed` / `Task Failed`. Reads job DAG, finds ready tasks, enqueues to SQS.

### `services/business-services/dispatcher/serverless.yml`

```yaml
service: job-manager-dispatcher

build:
  esbuild: true

custom:
  resources: ${file(../../../config/config.${self:provider.stage}.yml)}
  imports:
    queueUrl: !ImportValue job-manager-queue-url-${self:provider.stage}
    queueArn: !ImportValue job-manager-queue-arn-${self:provider.stage}
    eventsTableName: !ImportValue job-manager-events-table-name-${self:provider.stage}
    eventsTableArn: !ImportValue job-manager-events-table-arn-${self:provider.stage}
    eventBusName: !ImportValue job-manager-event-bus-name-${self:provider.stage}

provider:
  name: aws
  runtime: nodejs22.x
  stage: ${opt:stage, 'dev'}
  region: ${opt:region, 'eu-west-1'}
  profile: ${self:custom.resources.profile, 'default'}
  stackTags:
    Team: job-manager-dispatcher-${self:provider.stage}
  environment:
    ENVIRONMENT: ${self:provider.stage}
    TASK_QUEUE_URL: ${self:custom.imports.queueUrl}
    EVENTS_TABLE: ${self:custom.imports.eventsTableName}
    EVENT_BUS_NAME: ${self:custom.imports.eventBusName}
    TENANT_ID: gbInnovations
    APP_NAME: task-workflow

functions:

  task-dispatcher:
    handler: src/task-dispatcher.handler
    description: Dispatches next tasks when DAG dependencies are met
    timeout: 30
    memorySize: 256
    events:
      - eventBridge:
          eventBus: ${self:custom.imports.eventBusName}
          pattern:
            detail-type:
              - "log-event"
            detail:
              eventType:
                - "Task Completed"
                - "Task Failed"
    iamRoleStatements:
      - Effect: Allow
        Action: dynamodb:Query
        Resource:
          - ${self:custom.imports.eventsTableArn}
          - ${self:custom.imports.eventsTableArn}/index/*
      - Effect: Allow
        Action: sqs:SendMessage
        Resource: ${self:custom.imports.queueArn}
      - Effect: Allow
        Action: events:PutEvents
        Resource: "*"
```

Full dispatcher logic: [job-orchestration.md](../job-orchestration.md) § Dispatcher Lambda

---

## 5. Health Check Service

Scheduled Lambda that monitors processing tasks and alerts via Slack.

### `services/business-services/health-check/serverless.yml`

```yaml
service: job-manager-health-check

build:
  esbuild: true

custom:
  resources: ${file(../../../config/config.${self:provider.stage}.yml)}
  imports:
    eventsTableName: !ImportValue job-manager-events-table-name-${self:provider.stage}
    eventsTableArn: !ImportValue job-manager-events-table-arn-${self:provider.stage}
    eventBusName: !ImportValue job-manager-event-bus-name-${self:provider.stage}
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
    Team: job-manager-health-check-${self:provider.stage}
  environment:
    ENVIRONMENT: ${self:provider.stage}
    EVENTS_TABLE: ${self:custom.imports.eventsTableName}
    EVENT_BUS_NAME: ${self:custom.imports.eventBusName}
    TENANT_ID: gbInnovations
    APP_NAME: task-workflow
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
        Action: dynamodb:Query
        Resource:
          - ${self:custom.imports.eventsTableArn}
          - ${self:custom.imports.eventsTableArn}/index/*
      - Effect: Allow
        Action: events:PutEvents
        Resource: "*"

  health-check-single:
    handler: src/health-check.checkSingle
    description: Check health of a specific task by requestId (manual invoke)
    timeout: 30
    memorySize: 256
    iamRoleStatements:
      - Effect: Allow
        Action: dynamodb:Query
        Resource:
          - ${self:custom.imports.eventsTableArn}
          - ${self:custom.imports.eventsTableArn}/index/*
```

Full health check logic: [health-check.md](../health-check.md)

---

## 6. Consumer Service (Local / PM2)

The only non-serverless service. Runs locally via PM2.

### `services/business-services/consumer/ecosystem.config.cjs`

```javascript
module.exports = {
  apps: [{
    name: 'sqs-worker',
    script: 'src/worker/sqs-worker.cjs',
    instances: 3,
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 5000,
    kill_timeout: 5000,
    cron_restart: '0 2 * * *',           // daily at 2 AM
    error_file: '.output/logs/err.log',
    out_file: '.output/logs/out.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'dev'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
```

### `services/business-services/consumer/.env`

```bash
# AWS
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# SQS
SQS_QUEUE_URL=https://sqs.eu-west-1.amazonaws.com/123456789/task-queue-dev
MAX_MESSAGES=1
WAIT_TIME_SECONDS=20
VISIBILITY_EXTENSION_INTERVAL=20000
VISIBILITY_EXTENSION_AMOUNT=30
MAX_MESSAGE_RETRIES=3

# Claude
CLAUDE_CODE_OAUTH_TOKEN=...
CLAUDE_MODEL=claude-opus-4-5
CLAUDE_TIMEOUT=200000
MAX_CONCURRENT_CLAUDE=3
DEFAULT_TIMEOUT=120000

# DynamoDB
TASK_DEFINITIONS_TABLE=task-definitions-dev

# EventBridge
EVENTBRIDGE_BUS_NAME=job-manager-dev

# App
TENANT_ID=gbInnovations
APP_NAME=task-workflow
S3_BUCKET=job-manager-artifacts-dev
DELETE_FILES_AFTER_UPLOAD=false
NODE_ENV=dev
```

### Commands

```bash
cd consumer

# Install
npm install

# Start (dev)
pm2 start ecosystem.config.cjs

# Start (prod)
pm2 start ecosystem.config.cjs --env production

# Monitor
pm2 monit
pm2 logs sqs-worker

# Restart
pm2 restart sqs-worker

# Stop
pm2 stop sqs-worker
pm2 delete sqs-worker
```

Full consumer logic: [consumer-architecture.md](../consumer-architecture.md)

---

## Shared Config File

```yaml
# config/config.dev.yml
profile: default
slackBotToken: xoxb-dev-token
slackWebhookUrl: https://hooks.slack.com/services/...
alertChannel: "#dev-alerts"
```

```yaml
# config/config.prod.yml
profile: prod
slackBotToken: xoxb-prod-token
slackWebhookUrl: https://hooks.slack.com/services/...
alertChannel: "#prod-alerts"
```

---

## Service Dependencies Matrix

```
                    SQS    SQS    Events  TaskDefs  Event   S3
                    Queue  DLQ    Table   Table     Bus     Bucket
                    ─────  ─────  ──────  ────────  ─────   ──────
infrastructure      owns   owns   owns    owns      owns    owns
event               -      read   write   -         read    -
producer-api        write  -      read    read/write write   -
dispatcher          write  -      read    -         read/write -
health-check        -      -      read    -         write   -
consumer            read   -      -       read      write   write
```

read = query/get, write = put/send, read/write = both
