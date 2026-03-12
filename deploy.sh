#!/usr/bin/env bash
set -euo pipefail

# ─── Deploy all job-manager services ────────────────────────────────
#
# Usage:
#   ./deploy.sh              # deploy dev stage
#   ./deploy.sh prod         # deploy prod stage
#   ./deploy.sh dev --verbose # pass extra serverless flags
#
# Order:
#   1. Infrastructure (SQS, EventBridge, DynamoDB, S3)
#   2. All business services in parallel (they depend on infra resources)
#
# Consumer (PM2 worker) is NOT deployed here — it runs on EC2/locally
# via: cd services/business-services/consumer && pm2 start ecosystem.config.cjs

STAGE="${1:-dev}"
REGION="eu-west-1"
shift 2>/dev/null || true
EXTRA_ARGS="$*"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
INFRA_DIR="$ROOT_DIR/services/infrastructure/job-manager-infrastructure"

BUSINESS_SERVICES=(
  "$ROOT_DIR/services/business-services/event"
  "$ROOT_DIR/services/business-services/producer-api"
  "$ROOT_DIR/services/business-services/dispatcher"
  "$ROOT_DIR/services/business-services/health-check"
)

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()   { echo -e "${CYAN}[deploy]${NC} $*"; }
ok()    { echo -e "${GREEN}[  ok  ]${NC} $*"; }
fail()  { echo -e "${RED}[FAILED]${NC} $*"; }
warn()  { echo -e "${YELLOW}[ warn ]${NC} $*"; }

# ─── Step 1: Infrastructure ────────────────────────────────────────

log "Deploying infrastructure (stage: $STAGE)..."
if (cd "$INFRA_DIR" && npx serverless deploy --stage "$STAGE" --region "$REGION" $EXTRA_ARGS); then
  ok "Infrastructure deployed"
else
  fail "Infrastructure deployment failed — aborting"
  exit 1
fi

# ─── Step 2: Business services (parallel) ──────────────────────────

log "Deploying ${#BUSINESS_SERVICES[@]} business services in parallel (stage: $STAGE)..."

pids=()
svc_names=()

for svc_dir in "${BUSINESS_SERVICES[@]}"; do
  svc_name="$(basename "$svc_dir")"
  svc_names+=("$svc_name")

  (
    cd "$svc_dir"
    log "  Starting $svc_name..."
    if npx serverless deploy --stage "$STAGE" --region "$REGION" $EXTRA_ARGS > /tmp/deploy-"$svc_name".log 2>&1; then
      ok "  $svc_name deployed"
    else
      fail "  $svc_name failed — see /tmp/deploy-$svc_name.log"
      exit 1
    fi
  ) &
  pids+=($!)
done

# Wait for all and collect results
has_failure=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    fail "${svc_names[$i]} deployment failed"
    has_failure=1
  fi
done

# ─── Summary ───────────────────────────────────────────────────────

echo ""
if [ "$has_failure" -eq 0 ]; then
  ok "All services deployed successfully (stage: $STAGE)"
  warn "Consumer (PM2 worker) is not deployed by this script."
  warn "To deploy it: cd services/business-services/consumer && pm2 start ecosystem.config.cjs"
else
  fail "Some services failed to deploy — check logs in /tmp/deploy-*.log"
  exit 1
fi
