# Integration Test — Embedded Task Config (Job Saved)

## Setup

```bash
API_URL="https://fesjs5u504.execute-api.eu-west-1.amazonaws.com/dev"
API_KEY="SomUi5hF9E5pXXYE1eoaM36cJzsj5eGoaA6NfDyX"
```

---

## Step 1 — POST /jobs with full task fields

Expected: 201 with `jobId`, `totalTasks: 2`, `rootTasks: ["task-1"]`

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "task-1",
        "name": "color-tags",
        "description": "Tag all images with colors",
        "tag": "designer",
        "requiresReview": true,
        "repo": "my-org/repo",
        "input": {"folder": "/images"},
        "dependsOn": []
      },
      {
        "taskId": "task-2",
        "name": "summarize",
        "description": "Summarize the tagged images",
        "tag": "analyst",
        "requiresReview": false,
        "input": {},
        "dependsOn": ["task-1"]
      }
    ]
  }' | jq .
```

Save the jobId:

```bash
JOB_ID="<paste jobId here>"
```

## Step 2 — Verify Job Saved event in DynamoDB (GSI5)

Expected: One event with `eventType: "Job Saved"`, `properties.tasks` with 2 tasks including `description`, `tag`, `requiresReview`, `repo`

```bash
aws dynamodb query \
  --table-name events-dev \
  --index-name GSI5-index \
  --key-condition-expression "GSI5PK = :pk AND begins_with(GSI5SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"EVENT#Job Saved"},":sk":{"S":"TENANT#gbInnovations#JOB#'"$JOB_ID"'"}}' \
  --scan-index-forward false --limit 1 \
  --region eu-west-1 --profile default \
  | jq '.Items[0] | {eventType, entityId, properties: {jobId: .properties.jobId, totalTasks: .properties.totalTasks, tasks: [.properties.tasks[] | {taskId, name, description, tag, requiresReview, repo}]}}'
```

## Step 3 — GET /jobs/{id}

Expected: `tasks` array with `description`, `tag`, `requiresReview`, `repo` per task

```bash
curl -s "$API_URL/jobs/$JOB_ID" \
  -H "x-api-key: $API_KEY" | jq .
```

## Step 4 — GET /jobs (list, deduplication check)

Expected: Job appears once, no duplicates

```bash
curl -s "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" | jq .
```

## Step 5 — POST /jobs/{id}/tasks (add tasks, merged Job Saved)

Expected: 200 with `totalTasksNow: 3`

```bash
curl -s -X POST "$API_URL/jobs/$JOB_ID/tasks" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "task-3",
        "name": "review-summary",
        "description": "Review the summary for accuracy",
        "tag": "reviewer",
        "requiresReview": false,
        "input": {},
        "dependsOn": ["task-2"]
      }
    ]
  }' | jq .
```

## Step 6 — Verify second Job Saved (full snapshot)

Expected: Latest Job Saved has 3 tasks (task-1, task-2, task-3)

```bash
aws dynamodb query \
  --table-name events-dev \
  --index-name GSI5-index \
  --key-condition-expression "GSI5PK = :pk AND begins_with(GSI5SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"EVENT#Job Saved"},":sk":{"S":"TENANT#gbInnovations#JOB#'"$JOB_ID"'"}}' \
  --scan-index-forward false --limit 1 \
  --region eu-west-1 --profile default \
  | jq '.Items[0].properties.tasks | length'
```

## Step 7 — GET /jobs/{id} after add-tasks

Expected: 3 tasks with full fields

```bash
curl -s "$API_URL/jobs/$JOB_ID" \
  -H "x-api-key: $API_KEY" | jq '.tasks[] | {taskId, name, description, tag, requiresReview, repo, status}'
```

## Step 8 — GET /jobs (deduplication after two Job Saved events)

Expected: Job appears exactly once

```bash
curl -s "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" | jq '[.jobs[] | select(.jobId == "'"$JOB_ID"'")] | length'
```

## Step 9 — Validation: missing description/tag

Expected: 400 with validation errors for `description` and `tag`

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "bad-task",
        "name": "incomplete",
        "input": {},
        "dependsOn": []
      }
    ]
  }' | jq .
```

## Step 10 — Verify old endpoints removed

Expected: 403 (missing route, API Gateway returns 403 for unknown paths with API key)

```bash
echo "=== PUT /task-definitions should not exist ==="
curl -s -o /dev/null -w "%{http_code}" -X PUT "$API_URL/task-definitions/test" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description":"test","tag":"test"}'

echo ""
echo "=== GET /task-definitions should not exist ==="
curl -s -o /dev/null -w "%{http_code}" "$API_URL/task-definitions" \
  -H "x-api-key: $API_KEY"
```

---

## All steps in one block

```bash
API_URL="https://fesjs5u504.execute-api.eu-west-1.amazonaws.com/dev"
API_KEY="SomUi5hF9E5pXXYE1eoaM36cJzsj5eGoaA6NfDyX"

echo "=== Step 1: POST /jobs with full task fields ==="
RESPONSE=$(curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "task-1",
        "name": "color-tags",
        "description": "Tag all images with colors",
        "tag": "designer",
        "requiresReview": true,
        "repo": "my-org/repo",
        "input": {"folder": "/images"},
        "dependsOn": []
      },
      {
        "taskId": "task-2",
        "name": "summarize",
        "description": "Summarize the tagged images",
        "tag": "analyst",
        "requiresReview": false,
        "input": {},
        "dependsOn": ["task-1"]
      }
    ]
  }')
echo "$RESPONSE" | jq .
JOB_ID=$(echo "$RESPONSE" | jq -r '.jobId')
echo "JOB_ID=$JOB_ID"

sleep 2

echo ""
echo "=== Step 2: Verify Job Saved in DynamoDB (GSI5) ==="
aws dynamodb query \
  --table-name events-dev \
  --index-name GSI5-index \
  --key-condition-expression "GSI5PK = :pk AND begins_with(GSI5SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"EVENT#Job Saved"},":sk":{"S":"TENANT#gbInnovations#JOB#'"$JOB_ID"'"}}' \
  --scan-index-forward false --limit 1 \
  --region eu-west-1 --profile default \
  | jq '.Items[0] | {eventType, entityId, tasks_count: (.properties.tasks | length)}'

echo ""
echo "=== Step 3: GET /jobs/{id} ==="
curl -s "$API_URL/jobs/$JOB_ID" \
  -H "x-api-key: $API_KEY" | jq '{jobId, status, totalTasks, tasks: [.tasks[] | {taskId, name, description, tag, requiresReview, status}]}'

echo ""
echo "=== Step 4: GET /jobs (list) ==="
curl -s "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" | jq '.jobs | length'

echo ""
echo "=== Step 5: POST /jobs/{id}/tasks (add task-3) ==="
curl -s -X POST "$API_URL/jobs/$JOB_ID/tasks" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "task-3",
        "name": "review-summary",
        "description": "Review the summary for accuracy",
        "tag": "reviewer",
        "requiresReview": false,
        "input": {},
        "dependsOn": ["task-2"]
      }
    ]
  }' | jq .

sleep 1

echo ""
echo "=== Step 6: Latest Job Saved has 3 tasks ==="
aws dynamodb query \
  --table-name events-dev \
  --index-name GSI5-index \
  --key-condition-expression "GSI5PK = :pk AND begins_with(GSI5SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"EVENT#Job Saved"},":sk":{"S":"TENANT#gbInnovations#JOB#'"$JOB_ID"'"}}' \
  --scan-index-forward false --limit 1 \
  --region eu-west-1 --profile default \
  | jq '.Items[0].properties.tasks | length'

echo ""
echo "=== Step 7: GET /jobs/{id} after add-tasks ==="
curl -s "$API_URL/jobs/$JOB_ID" \
  -H "x-api-key: $API_KEY" | jq '.tasks[] | {taskId, name, description, tag, requiresReview, repo, status}'

echo ""
echo "=== Step 8: GET /jobs deduplication check ==="
curl -s "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" | jq '[.jobs[] | select(.jobId == "'"$JOB_ID"'")] | length'

echo ""
echo "=== Step 9: Validation — missing description/tag ==="
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"taskId":"bad","name":"incomplete","input":{},"dependsOn":[]}]}' | jq .

echo ""
echo "=== Step 10: Old endpoints removed ==="
echo -n "PUT /task-definitions: "
curl -s -o /dev/null -w "%{http_code}" -X PUT "$API_URL/task-definitions/test" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description":"test","tag":"test"}'
echo ""
echo -n "GET /task-definitions: "
curl -s -o /dev/null -w "%{http_code}" "$API_URL/task-definitions" \
  -H "x-api-key: $API_KEY"

echo ""
echo "=== Done ==="
```
