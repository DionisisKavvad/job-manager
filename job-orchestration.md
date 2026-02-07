# Job Orchestration — Multi-Task Workflows

Dispatcher Lambda that coordinates DAG-based multi-task workflows. Extends the core consumer ([consumer-architecture.md](./consumer-architecture.md)) and shared event system ([event-system.md](./event-system.md)).

---

## Problem

A single SQS message = a single independent task. But sometimes a **request** requires multiple tasks, some of which are sequential:

```
Example: "Generate full task for store X"
  ├── Task A: Scrape store data          (independent)
  ├── Task B: Analyze competitors        (independent)
  ├── Task C: Generate color tags        (depends on A)
  ├── Task D: Generate font pairing      (depends on A)
  └── Task E: Compile final result       (depends on C + D)
```

Tasks A and B can run in **parallel**. C and D wait for A. E waits for both C and D.

---

## Concept: Job = DAG of Tasks

A **Job** is a directed acyclic graph (DAG) where:
- Each node is a **Task** (= SQS message → worker processes it)
- Edges define **dependencies** (task C depends on task A)
- A Job is **completed** when all its tasks are completed
- A Job has **failure detected** if any non-retryable task fails — in-progress tasks continue, job can be resumed later

```
        ┌─── Task A ───┬─── Task C ───┐
Job ────┤               │              ├──→ Task E ──→ Job Completed
        └─── Task B    └─── Task D ───┘
```

---

## Data Model — Event-Sourced (same DynamoDB table)

No new tables. Jobs and task dependencies are tracked as events.

### Job Created Event

Emitted by the producer when a multi-task request is submitted:

```javascript
{
  eventType: "Job Created",
  GSI1PK: "JOB#job-456",
  GSI1SK: "TIMESTAMP#...",
  GSI2PK: "APP#task-workflow",
  GSI2SK: "TIMESTAMP#...",
  properties: {
    jobId: "job-456",
    requestId: "req-789",       // original request that spawned this job
    tasks: [
      { taskId: "task-A", name: "scrape-store",      dependsOn: [], input: { storeId: "store-123" } },
      { taskId: "task-B", name: "analyze-competitors", dependsOn: [], input: { market: "fashion" } },
      { taskId: "task-C", name: "color-tags",         dependsOn: ["task-A"], input: { style: "modern" } },
      { taskId: "task-D", name: "font-pairing",       dependsOn: ["task-A"], input: {} },
      { taskId: "task-E", name: "compile-result",      dependsOn: ["task-C", "task-D"], input: {} }
    ],
    totalTasks: 5
  }
}
```

### Task events carry a jobId

Each task's events include the jobId so they can be linked:

```javascript
// Task Pending (when enqueued to SQS)
{
  eventType: "Task Pending",
  GSI1PK: "TASK#task-A",
  properties: {
    taskId: "task-A",
    jobId: "job-456",             // ← links task to job
    name: "scrape-store",
    dependsOn: []
  }
}

// Task Completed
{
  eventType: "Task Completed",
  GSI1PK: "TASK#task-A",
  properties: {
    taskId: "task-A",
    jobId: "job-456",
    output: { ... }               // result passed to dependent tasks
  }
}
```

---

## Orchestration Flow

```
1. Producer submits job
   │
   │  Emit "Job Created" event (with full task DAG)
   │  Enqueue root tasks (no dependencies) to SQS
   │  Emit "Task Pending" for each root task
   │
   ├──→ SQS: task-A (no deps → immediate)
   ├──→ SQS: task-B (no deps → immediate)
   │
2. Workers process root tasks in parallel
   │
   │  task-A completes → "Task Completed" event
   │  task-B completes → "Task Completed" event
   │
3. EventBridge rule triggers Dispatcher Lambda on "Task Completed"
   │
   │  Dispatcher:
   │    a) Read job DAG from "Job Created" event (GSI1PK = JOB#job-456)
   │    b) Query all task statuses for this job
   │    c) Find tasks whose dependencies are ALL completed
   │    d) Enqueue newly-ready tasks to SQS
   │    e) If ALL tasks completed → emit "Job Completed"
   │    f) If task failed (non-retryable) → emit "Job Failure Detected"
   │
   ├──→ task-A done → dispatcher checks → C and D are ready → enqueue both
   ├──→ task-B done → dispatcher checks → nothing new to dispatch
   │
4. Workers process C and D in parallel
   │
   │  task-C completes → dispatcher → E still waiting for D
   │  task-D completes → dispatcher → E is ready → enqueue
   │
5. Worker processes E
   │
   │  task-E completes → dispatcher → all 5 tasks done → "Job Completed"
```

---

## Dispatcher Lambda

Triggered by EventBridge rule on "Task Completed" / "Task Failed" events:

```yaml
# In serverless.yml — add to functions:
  task-dispatcher:
    handler: src/task-dispatcher.handler
    description: Dispatches next tasks when dependencies are met
    timeout: 30
    memorySize: 256
    environment:
      TASK_QUEUE_URL: !Ref TaskQueue
    events:
      - eventBridge:
          eventBus: ${self:service}-${self:provider.stage}
          pattern:
            detail-type:
              - "log-event"
            detail:
              eventType:
                - "Task Completed"
                - "Task Failed"
    iamRoleStatements:
      - Effect: Allow
        Action:
          - dynamodb:Query
        Resource:
          - arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:provider.environment.EVENTS_TABLE}
          - arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:provider.environment.EVENTS_TABLE}/index/*
      - Effect: Allow
        Action:
          - sqs:SendMessage
        Resource: !GetAtt TaskQueue.Arn
      - Effect: Allow
        Action:
          - events:PutEvents
        Resource: "*"
```

```javascript
// src/task-dispatcher.js

export async function handler(event) {
  const detail = event.detail;
  const jobId = detail.properties?.jobId;

  if (!jobId) return; // standalone task, no job orchestration needed

  // 1. Get job definition (task DAG — from Job Created + any Job Tasks Added)
  const allJobEvents = await getAllJobEvents(jobId);  // GSI1: JOB#{jobId}
  const jobCreated = allJobEvents.find(e => e.eventType === 'Job Created');
  const tasksAdded = allJobEvents.filter(e => e.eventType === 'Job Tasks Added');

  let taskDag = [...jobCreated.properties.tasks];
  for (const added of tasksAdded) {
    taskDag = [...taskDag, ...added.properties.newTasks];
  }

  // 2. Get current status of all tasks in this job
  const taskStatuses = {};
  for (const task of taskDag) {
    const latestEvent = await getLatestTaskEvent(task.taskId);
    taskStatuses[task.taskId] = latestEvent
      ? EVENT_TO_STATE[latestEvent.eventType]
      : null;
  }

  // 3. Check for non-retryable failure → emit detection event (don't stop dispatching)
  const failedTasks = taskDag.filter(t => taskStatuses[t.taskId] === 'failed');
  if (failedTasks.length > 0) {
    // Check if we already emitted Job Failure Detected for this job
    const existingFailure = await getJobFailureDetectedEvent(jobId);
    if (!existingFailure) {
      await emitEvent('Job Failure Detected', {
        jobId,
        failedTaskId: failedTasks[0].taskId,
        taskStatuses
      });
    }
    // Don't return — continue dispatching ready tasks.
    // In-progress and independent tasks keep running.
  }

  // 4. Find tasks ready to dispatch (all dependencies completed)
  const readyTasks = taskDag.filter(task => {
    if (taskStatuses[task.taskId]) return false; // already started or done
    return task.dependsOn.every(depId => taskStatuses[depId] === 'completed');
  });

  // 5. Enqueue ready tasks to SQS
  for (const task of readyTasks) {
    // Gather outputs from completed dependencies
    const dependencyOutputs = {};
    for (const depId of task.dependsOn) {
      const completedEvent = await getTaskCompletedEvent(depId);
      dependencyOutputs[depId] = completedEvent.properties.output;
    }

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.TASK_QUEUE_URL,
      MessageBody: JSON.stringify({
        taskId: task.taskId,
        jobId,
        name: task.name,
        input: task.input || {},              // static input from job definition
        dependencyOutputs                     // outputs from completed parent tasks
      }),
      MessageAttributes: {
        requestId: { DataType: 'String', StringValue: task.taskId }
      }
    }));

    await emitEvent('Task Pending', {
      taskId: task.taskId,
      jobId,
      name: task.name,
      dependsOn: task.dependsOn
    });
  }

  // 6. Check if all tasks are completed → job done
  const allCompleted = taskDag.every(t => taskStatuses[t.taskId] === 'completed');
  if (allCompleted) {
    await emitEvent('Job Completed', {
      jobId,
      totalTasks: taskDag.length,
      taskStatuses
    });
  }
}
```

---

## Query Patterns for Jobs

```javascript
// All events for a job (Job Created, Job Completed / Job Failure Detected)
Query GSI1: GSI1PK = "JOB#job-456"
→ Job Created, Job Completed / Job Failure Detected

// All tasks for a job (from the Job Created event)
const jobEvent = await getJobCreatedEvent(jobId);
const tasks = jobEvent.properties.tasks;

// Status of each task (latest event per taskId)
for (const task of tasks) {
  Query GSI1: GSI1PK = "TASK#${taskId}"
  ScanIndexForward: false, Limit: 1
}
```

---

## Job State Machine

```
Job Created
    │
    │  Dispatch root tasks (no dependencies)
    │
    ├──→ Task A: pending → processing → completed ─┐
    ├──→ Task B: pending → processing → completed  │
    │                                               │
    │  Dispatcher checks dependencies               │
    │                                               │
    ├──→ Task C: pending → processing → completed ─┤  (unlocked by A)
    ├──→ Task D: pending → processing → completed ─┤  (unlocked by A)
    │                                               │
    │  Dispatcher checks dependencies               │
    │                                               │
    └──→ Task E: pending → processing → completed   (unlocked by C+D)
              │
              ▼
         Job Completed

    At any point:
    Task X failed (non-retryable) → Job Failure Detected
    (in-progress tasks continue, job can be resumed later)
```

---

## Architecture Summary

```
Producer
    │
    │  "Job Created" event (task DAG)
    │  Enqueue root tasks to SQS
    ▼
┌────────────────────┐     ┌─────────────────────────────┐
│    SQS Queue       │────→│  Workers (sqs-worker.cjs)   │
│  (task-queue)     │     │  Process individual tasks    │
└────────────────────┘     └──────────────┬──────────────┘
         ▲                                │
         │ Enqueue                        │ "Task Completed" event
         │ ready tasks                    ▼
         │                  ┌─────────────────────────────┐
         │                  │  EventBridge                 │
         │                  └──────────────┬──────────────┘
         │                                 │
         │                                 ▼
         │                  ┌─────────────────────────────┐
         └──────────────────│  Dispatcher Lambda          │
                            │                              │
                            │  1. Read job DAG             │
                            │  2. Query task statuses      │
                            │  3. Find ready tasks         │
                            │  4. Enqueue to SQS           │
                            │  5. Emit Job Completed / Job Failure Detected│
                            └─────────────────────────────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │  DynamoDB     │
                                    │  (events)     │
                                    └──────────────┘
```

---

## Trade-offs vs Step Functions

| | This approach (Event-sourced DAG) | AWS Step Functions |
|---|---|---|
| Infra | Same DynamoDB + SQS + 1 Lambda | Separate state machine |
| Cost | Pay per event + Lambda invoke | Pay per state transition |
| Visibility | Query events in same table | Step Functions console |
| Flexibility | Custom DAG logic, any task type | Visual workflow editor |
| Complexity | ~100 lines dispatcher code | Managed by AWS |
| State | Event-sourced (audit trail) | Managed (less visible) |
| Timeout | Custom (via heartbeats) | Built-in (max 1 year) |

**When to use Step Functions instead**: If you need complex branching (Choice states), parallel with error handling, Map states for dynamic parallelism, or visual debugging.

**When this approach wins**: If tasks are already SQS-based, you want a unified event trail, and the DAG is defined by the producer (not hardcoded in IaC).
