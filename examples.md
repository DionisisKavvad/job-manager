# Job Manager — Runnable Examples

## Setup

```bash
API_URL="https://fesjs5u504.execute-api.eu-west-1.amazonaws.com/dev"
API_KEY="SomUi5hF9E5pXXYE1eoaM36cJzsj5eGoaA6NfDyX"
```

---

## Example 1: Feature Implementation (Single Repo, με Review)

Ένα job που υλοποιεί ένα νέο endpoint σε Express API + γράφει tests.
Το πρώτο task χρειάζεται human review πριν προχωρήσει στα tests.

**DAG:**
```
implement-endpoint (review required)
        ↓
   write-tests
```

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "implement-endpoint",
        "name": "Implement GET /users/:id/orders",
        "tag": "backend-developer",
        "description": "Create a new GET endpoint at /users/:id/orders that returns paginated orders for a user. Use the existing Order model and follow the patterns in src/routes/users.ts. Include query params: page, limit, status filter. Return 404 if user not found.",
        "repo": "myorg/ecommerce-api",
        "input": {
          "techStack": "Express + TypeScript + Prisma",
          "existingEndpoints": ["/users", "/users/:id", "/orders"]
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
        "name": "Write integration tests",
        "tag": "test-engineer",
        "description": "Write comprehensive integration tests for GET /users/:id/orders. Cover: happy path with pagination, status filter, user not found (404), invalid params (400). Follow the patterns in __tests__/routes/.",
        "repo": "myorg/ecommerce-api",
        "dependsOn": ["implement-endpoint"],
        "maxTurns": 25,
        "feedbackCommands": {
          "lint": "npm run lint",
          "test": "npm test"
        }
      }
    ]
  }' | jq .
```

**Τι θα γίνει:**
1. `implement-endpoint` γίνεται pending αμέσως (root task, δεν εξαρτάται από κάτι)
2. Ο Claude agent κάνει clone το repo, δημιουργεί worktree, γράφει τον endpoint
3. Τρέχει lint → typecheck → test (feedback loop, max 2 rounds auto-fix)
4. Αφού περάσουν → **"Task Submitted For Review"** (λόγω `requiresReview: true`)
5. Περιμένει human review — approve ή revision
6. Μετά το approve → `write-tests` ξεκλειδώνει, ο agent γράφει tests βάσει του output

---

## Example 2: Multi-Repo Refactoring (Parallel Tasks)

Μετονομασία ενός shared type σε 3 repos. Τα backend + frontend tasks τρέχουν **παράλληλα** μετά το shared.

**DAG:**
```
    update-shared-types
        ↓         ↓
update-backend  update-frontend  (parallel)
```

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "update-shared-types",
        "name": "Rename UserProfile to AccountProfile",
        "tag": "developer",
        "description": "Rename the UserProfile interface to AccountProfile in src/types/user.ts. Update all internal references within the shared-types package. Export both names with a @deprecated JSDoc comment on UserProfile for backwards compatibility.",
        "repo": "myorg/shared-types",
        "feedbackCommands": {
          "typecheck": "npx tsc --noEmit",
          "test": "npm test"
        }
      },
      {
        "taskId": "update-backend",
        "name": "Update backend imports",
        "tag": "backend-developer",
        "description": "Replace all UserProfile imports and usages with AccountProfile across the entire backend codebase. Update DTOs, service layer, and controller types.",
        "repo": "myorg/backend-api",
        "dependsOn": ["update-shared-types"],
        "feedbackCommands": {
          "typecheck": "npx tsc --noEmit",
          "test": "npm test"
        }
      },
      {
        "taskId": "update-frontend",
        "name": "Update frontend imports",
        "tag": "frontend-developer",
        "description": "Replace all UserProfile imports and usages with AccountProfile in the React app. Update component props, hook return types, and Zustand store types.",
        "repo": "myorg/frontend-app",
        "dependsOn": ["update-shared-types"],
        "feedbackCommands": {
          "typecheck": "npx tsc --noEmit",
          "test": "npm test"
        }
      }
    ]
  }' | jq .
```

**Τι θα γίνει:**
1. `update-shared-types` τρέχει πρώτο
2. Output: `{ "renamed": "UserProfile → AccountProfile", "filesChanged": [...] }`
3. `update-backend` + `update-frontend` ξεκινούν **ταυτόχρονα** σε ξεχωριστά repos/worktrees
4. Κάθε agent λαμβάνει τα `dependencyOutputs` από το shared-types task ως context

---

## Example 3: Bug Investigation + Fix Pipeline

Investigate → fix → update changelog. Chain 3 tasks.

**DAG:**
```
investigate-bug → fix-bug (review) → update-changelog
```

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "investigate-bug",
        "name": "Investigate login timeout",
        "tag": "debugger",
        "description": "Users report that login times out after 30 seconds on the /auth/login endpoint. Investigate the auth flow in src/auth/. Check for: unnecessary awaits, missing connection pool timeout, N+1 queries in user lookup, middleware bottlenecks. Return a root cause analysis with the exact file, line number, and explanation.",
        "repo": "myorg/webapp",
        "allowedTools": ["Read", "Glob", "Grep", "Bash"],
        "maxTurns": 20
      },
      {
        "taskId": "fix-bug",
        "name": "Fix login timeout",
        "tag": "developer",
        "description": "Based on the investigation results from the previous task, apply the minimal fix for the login timeout bug. Do not refactor unrelated code. Add a comment explaining why the change was made.",
        "repo": "myorg/webapp",
        "dependsOn": ["investigate-bug"],
        "requiresReview": true,
        "maxTurns": 15,
        "feedbackCommands": {
          "typecheck": "npx tsc --noEmit",
          "test": "npm test -- --grep auth"
        }
      },
      {
        "taskId": "update-changelog",
        "name": "Update CHANGELOG.md",
        "tag": "technical-writer",
        "description": "Add a new entry to CHANGELOG.md under the [Unreleased] section describing the login timeout fix. Follow the Keep a Changelog format already used in the file. Include the root cause and the fix applied.",
        "repo": "myorg/webapp",
        "dependsOn": ["fix-bug"],
        "allowedTools": ["Read", "Edit", "Glob"],
        "maxTurns": 5
      }
    ]
  }' | jq .
```

**Output chain:**
- `investigate-bug` → `{ "rootCause": "Missing pool timeout in src/auth/db.ts:45", "analysis": "..." }`
- `fix-bug` → λαμβάνει το analysis ως context, κάνει minimal fix, τρέχει tests
- `update-changelog` → λαμβάνει context και γράφει changelog entry

---

## Example 4: Data Pipeline (χωρίς repo)

Scraping → analysis → report. Κανένα task δεν χρειάζεται git repo.

**DAG:**
```
scrape-products → analyze-pricing → generate-report
```

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "scrape-products",
        "name": "Extract product data",
        "tag": "data-engineer",
        "description": "Fetch product listings from the provided API endpoint. For each product extract: name, price, category, rating, and availability. Return a structured JSON array sorted by category.",
        "input": {
          "apiEndpoint": "https://api.example.com/v1/products",
          "maxPages": 5
        },
        "allowedTools": ["Bash", "Write"],
        "maxTurns": 15
      },
      {
        "taskId": "analyze-pricing",
        "name": "Analyze product pricing",
        "tag": "data-analyst",
        "description": "Using the product data from the previous task, calculate: (1) average price per category, (2) price distribution percentiles (p25, p50, p75, p95), (3) top 10 most expensive products, (4) correlation between price and rating. Return structured JSON with all results.",
        "dependsOn": ["scrape-products"],
        "allowedTools": ["Bash", "Write"],
        "maxTurns": 20
      },
      {
        "taskId": "generate-report",
        "name": "Generate markdown report",
        "tag": "technical-writer",
        "description": "Create a clean, presentable markdown report from the analysis results. Include: executive summary, pricing tables per category, distribution chart (ASCII), key insights, and actionable recommendations. Format for readability.",
        "dependsOn": ["analyze-pricing"],
        "allowedTools": ["Write"],
        "maxTurns": 10
      }
    ]
  }' | jq .
```

---

## Example 5: Complex Diamond DAG (4 parallel branches)

Design system generation: 1 scraper feeds 4 parallel specialists, then 1 compiler merges.

**DAG:**
```
        scrape-brand
       ↓    ↓    ↓    ↓
  colors  fonts  icons  layout   (all 4 parallel)
       ↓    ↓    ↓    ↓
      compile-design-system
```

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "scrape-brand",
        "name": "Scrape brand assets",
        "tag": "scraper",
        "description": "Analyze the website at the provided URL. Extract: primary/secondary/accent colors (hex), font families used, icon style (outline/filled/mixed), and layout grid system. Return structured JSON.",
        "input": {
          "url": "https://stripe.com",
          "sections": ["homepage", "pricing", "docs"]
        },
        "allowedTools": ["Bash", "Write"],
        "maxTurns": 15
      },
      {
        "taskId": "color-palette",
        "name": "Generate color system",
        "tag": "designer",
        "description": "From the scraped brand colors, generate a complete color system: 10-shade scale for each color (50-900), semantic tokens (background, surface, text-primary, text-secondary, border, error, success, warning), WCAG AA contrast ratios for all text/background combinations.",
        "dependsOn": ["scrape-brand"],
        "requiresReview": true,
        "maxTurns": 20
      },
      {
        "taskId": "typography",
        "name": "Define typography scale",
        "tag": "designer",
        "description": "From the scraped fonts, define a typography system: type scale (xs through 4xl) with font-size, line-height, letter-spacing. Define font weights for headings vs body. Suggest a fallback font stack for each family.",
        "dependsOn": ["scrape-brand"],
        "maxTurns": 15
      },
      {
        "taskId": "iconography",
        "name": "Define icon guidelines",
        "tag": "designer",
        "description": "Based on the scraped icon style, define icon guidelines: recommended icon library (Lucide, Heroicons, etc.), sizing scale (sm/md/lg/xl), stroke width, padding rules, and usage patterns for common UI elements (nav, buttons, inputs, alerts).",
        "dependsOn": ["scrape-brand"],
        "maxTurns": 10
      },
      {
        "taskId": "layout-system",
        "name": "Define layout and spacing",
        "tag": "designer",
        "description": "From the scraped layout grid, define: spacing scale (4px base), breakpoints (sm/md/lg/xl/2xl), container max-widths, grid column system (12-col), and component spacing guidelines (padding/margin patterns).",
        "dependsOn": ["scrape-brand"],
        "maxTurns": 10
      },
      {
        "taskId": "compile-design-system",
        "name": "Compile design system spec",
        "tag": "compiler",
        "description": "Merge all design system outputs (colors, typography, icons, layout) into a single cohesive design system specification. Create a Tailwind CSS config file (tailwind.config.ts) with the custom theme and a design-tokens.json file. Ensure consistency across all sections.",
        "dependsOn": ["color-palette", "typography", "iconography", "layout-system"],
        "repo": "myorg/design-system",
        "requiresReview": true,
        "feedbackCommands": {
          "typecheck": "npx tsc --noEmit"
        },
        "maxTurns": 30
      }
    ]
  }' | jq .
```

**Τι θα γίνει:**
1. `scrape-brand` τρέχει πρώτο, εξάγει brand assets
2. 4 tasks ξεκινούν **παράλληλα** (colors, fonts, icons, layout) — κάθε ένα εξειδικεύεται
3. `compile-design-system` περιμένει **και τα 4** να τελειώσουν πριν ξεκινήσει
4. Ο compiler agent λαμβάνει **4 dependency outputs** στο prompt και τα συνδυάζει

---

## Example 6: Add Tasks σε Υπάρχον Job

Πρώτα δημιούργησε ένα job, μετά πρόσθεσε tasks σε αυτό.

### Step 1: Create initial job

```bash
RESPONSE=$(curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "research",
        "name": "Research auth approaches",
        "tag": "architect",
        "description": "Research and compare JWT vs session-based auth for our Express API. Consider: security, scalability, token refresh, logout, and multi-device support. Return a recommendation with pros/cons.",
        "maxTurns": 15
      }
    ]
  }')

echo "$RESPONSE" | jq .
JOB_ID=$(echo "$RESPONSE" | jq -r '.jobId')
echo "JOB_ID=$JOB_ID"
```

### Step 2: Add implementation tasks after research

```bash
curl -s -X POST "$API_URL/jobs/$JOB_ID/tasks" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "implement-auth",
        "name": "Implement auth system",
        "tag": "backend-developer",
        "description": "Based on the research recommendation, implement the chosen auth system. Create: auth middleware, login/logout/refresh endpoints, user model updates. Follow existing patterns in the codebase.",
        "repo": "myorg/api-server",
        "dependsOn": ["research"],
        "requiresReview": true,
        "maxTurns": 40,
        "feedbackCommands": {
          "lint": "npm run lint",
          "typecheck": "npx tsc --noEmit",
          "test": "npm test"
        }
      },
      {
        "taskId": "implement-auth-tests",
        "name": "Write auth tests",
        "tag": "test-engineer",
        "description": "Write unit and integration tests for the auth system. Cover: login success/failure, token refresh, expired tokens, logout, protected route access, rate limiting.",
        "repo": "myorg/api-server",
        "dependsOn": ["implement-auth"],
        "maxTurns": 30,
        "feedbackCommands": {
          "test": "npm test -- --grep auth"
        }
      }
    ]
  }' | jq .
```

---

## Example 7: Code Review + Refactoring

Ένας agent αναλύει code quality, ένας κάνει refactor, ένας verify.

**DAG:**
```
analyze-code-quality → refactor-module → verify-refactoring
```

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "analyze-code-quality",
        "name": "Analyze code quality of auth module",
        "tag": "code-reviewer",
        "description": "Analyze src/auth/ for code quality issues. Check for: functions over 50 lines, deeply nested conditionals (>3 levels), duplicated logic, missing error handling, inconsistent naming, God objects, tight coupling. Return a prioritized list of issues with severity (critical/high/medium/low), file paths, and suggested fixes.",
        "repo": "myorg/webapp",
        "allowedTools": ["Read", "Glob", "Grep"],
        "maxTurns": 25
      },
      {
        "taskId": "refactor-module",
        "name": "Refactor auth module",
        "tag": "senior-developer",
        "description": "Apply the refactoring suggestions from the code review. Focus only on critical and high severity issues. Make minimal, focused changes. Each change should be a logical unit. Do NOT change any public API signatures.",
        "repo": "myorg/webapp",
        "dependsOn": ["analyze-code-quality"],
        "requiresReview": true,
        "maxTurns": 35,
        "feedbackCommands": {
          "lint": "npm run lint",
          "typecheck": "npx tsc --noEmit",
          "test": "npm test -- --grep auth"
        }
      },
      {
        "taskId": "verify-refactoring",
        "name": "Verify no regressions",
        "tag": "qa-engineer",
        "description": "Run the full test suite and verify that all tests pass after the refactoring. Check that no public API changed by comparing the exported types before and after. Run a coverage report and compare with baseline. Return pass/fail status with details.",
        "repo": "myorg/webapp",
        "dependsOn": ["refactor-module"],
        "allowedTools": ["Read", "Bash", "Glob", "Grep"],
        "maxTurns": 15
      }
    ]
  }' | jq .
```

---

## Monitoring — Παρακολούθηση Job

Αφού δημιουργήσεις ένα job, μπορείς να παρακολουθείς:

### Δες το status του job

```bash
JOB_ID="<paste-your-job-id>"

curl -s "$API_URL/jobs/$JOB_ID" \
  -H "x-api-key: $API_KEY" | jq '{
    jobId,
    status,
    progress,
    tasks: [.tasks[] | {taskId, name, status, lastEventType}]
  }'
```

### Δες όλα τα jobs

```bash
curl -s "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" | jq '.jobs[] | {jobId, status, totalTasks}'
```

### Poll μέχρι να ολοκληρωθεί

```bash
JOB_ID="<paste-your-job-id>"

while true; do
  STATUS=$(curl -s "$API_URL/jobs/$JOB_ID" \
    -H "x-api-key: $API_KEY")

  echo "$STATUS" | jq '{status, progress}'

  JOB_STATUS=$(echo "$STATUS" | jq -r '.status')
  if [ "$JOB_STATUS" = "completed" ] || [ "$JOB_STATUS" = "partial_failure" ]; then
    echo "Job finished with status: $JOB_STATUS"
    echo "$STATUS" | jq '.tasks[] | {taskId, status}'
    break
  fi

  sleep 10
done
```

---

## Validation Examples — Error Cases

### Missing required fields

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "bad-task",
        "name": "incomplete task"
      }
    ]
  }' | jq .
```
Expected: `400` — missing `description` and `tag`

### Cycle detection

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "task-a",
        "name": "Task A",
        "description": "Does something",
        "tag": "dev",
        "dependsOn": ["task-b"]
      },
      {
        "taskId": "task-b",
        "name": "Task B",
        "description": "Does something else",
        "tag": "dev",
        "dependsOn": ["task-a"]
      }
    ]
  }' | jq .
```
Expected: `400` — cycle detected

### Invalid taskId format

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "invalid task id!",
        "name": "Bad ID",
        "description": "Has spaces and special chars",
        "tag": "dev"
      }
    ]
  }' | jq .
```
Expected: `400` — invalid taskId format

### Too many tasks (max 50)

```bash
# Generate 51 tasks
TASKS=$(python3 -c "
import json
tasks = [{'taskId': f'task-{i}', 'name': f'Task {i}', 'description': f'Task number {i}', 'tag': 'dev'} for i in range(51)]
print(json.dumps({'tasks': tasks}))
")

curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$TASKS" | jq .
```
Expected: `400` — too many tasks

### Invalid maxTurns

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "bad-turns",
        "name": "Bad maxTurns",
        "description": "maxTurns out of range",
        "tag": "dev",
        "maxTurns": 999
      }
    ]
  }' | jq .
```
Expected: `400` — maxTurns must be 1-200

### Invalid feedbackCommands key

```bash
curl -s -X POST "$API_URL/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "bad-feedback",
        "name": "Bad feedback commands",
        "description": "Uses invalid key",
        "tag": "dev",
        "feedbackCommands": {
          "build": "npm run build",
          "deploy": "npm run deploy"
        }
      }
    ]
  }' | jq .
```
Expected: `400` — only `lint`, `typecheck`, `test` allowed

---

## Quick Reference — Task Fields

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| `taskId` | Yes | string | `/^[a-zA-Z0-9-_]{1,128}$/` |
| `name` | Yes | string | Non-empty |
| `description` | Yes | string | Non-empty (this is the Claude prompt) |
| `tag` | Yes | string | Non-empty (becomes Claude's role) |
| `dependsOn` | No | string[] | References to other taskIds in the job |
| `input` | No | object | Any structure, passed to agent prompt |
| `requiresReview` | No | boolean | Default: false |
| `repo` | No | string | GitHub repo, e.g. `"myorg/repo-name"` |
| `allowedTools` | No | string[] | Default: Read, Edit, Write, Bash, Glob, Grep |
| `maxTurns` | No | integer | Range 1-200 |
| `feedbackCommands` | No | object | Keys: `lint`, `typecheck`, `test` only |
