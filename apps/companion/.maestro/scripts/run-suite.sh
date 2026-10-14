#!/usr/bin/env bash
set -euo pipefail

#############################################################################
# Maestro E2E Test Runner — Single Suite
#
# Runs a single test suite by name.
#
# Usage:
#   ./run-suite.sh auth           # Run auth suite
#   ./run-suite.sh dashboard      # Run dashboard suite
#   ./run-suite.sh dark-mode      # Run dark mode suite
#############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAESTRO_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_DIR="$MAESTRO_DIR/results/$TIMESTAMP"

# Ensure Java + Maestro are on PATH
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH:$HOME/.maestro/bin"

# Suppress Maestro analytics + notifications
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Validate arguments
if [ $# -eq 0 ]; then
  echo -e "${YELLOW}Usage: $0 <suite-name>${NC}"
  echo ""
  echo "Available suites:"
  for dir in "$MAESTRO_DIR/flows"/*/; do
    [ -d "$dir" ] && echo "  $(basename "$dir")"
  done
  exit 1
fi

SUITE_NAME="$1"
SUITE_DIR="$MAESTRO_DIR/flows/$SUITE_NAME"

if [ ! -d "$SUITE_DIR" ]; then
  echo -e "${RED}✗ Suite not found: $SUITE_NAME${NC}"
  echo ""
  echo "Available suites:"
  for dir in "$MAESTRO_DIR/flows"/*/; do
    [ -d "$dir" ] && echo "  $(basename "$dir")"
  done
  exit 1
fi

# ─── Load environment variables ─────────────────────────────────────
# test.env, plus the ids each seed-e2e.sh fixture writes (env/e2e*.env).
# shellcheck source=lib/load-env.sh
source "$SCRIPT_DIR/lib/load-env.sh"
load_maestro_env "$MAESTRO_DIR"

echo -e "${CYAN}${BOLD}━━━ Running suite: $SUITE_NAME ━━━${NC}"
echo ""

# Create results dir
mkdir -p "$RESULTS_DIR"

# Toggle dark mode for dark-mode suite
if [ "$SUITE_NAME" = "dark-mode" ]; then
  xcrun simctl ui booted appearance dark 2>/dev/null || true
  echo -e "${YELLOW}  Set simulator to dark mode${NC}"
fi

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
FAILED_TESTS=()

for flow in "$SUITE_DIR"/*.yaml; do
  [ -f "$flow" ] || continue
  FLOW_NAME=$(basename "$flow" .yaml)

  echo -n "  ▸ $FLOW_NAME ... "

  # A missing config var fails the flow: test.env is incomplete. A missing
  # fixture var skips it: its fixture is not seeded.
  check_flow_vars "$flow"
  if [ -n "$MISSING_CONFIG_VARS" ]; then
    echo -e "${RED}FAIL${NC} (not set in env/test.env: $MISSING_CONFIG_VARS)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_TESTS+=("$FLOW_NAME")
    continue
  fi
  if [ -n "$MISSING_FIXTURE_VARS" ]; then
    echo -e "${YELLOW}SKIP${NC} (fixture not seeded: $MISSING_FIXTURE_VARS; see seed-e2e.sh)"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    continue
  fi

  FLOW_OUTPUT="$RESULTS_DIR/${SUITE_NAME}_${FLOW_NAME}.log"
  if maestro test "${MAESTRO_ENV_FLAGS[@]}" "$flow" --output "$RESULTS_DIR" > "$FLOW_OUTPUT" 2>&1; then
    echo -e "${GREEN}PASS${NC}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "${RED}FAIL${NC}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_TESTS+=("$FLOW_NAME")
  fi
done

# Reset dark mode
if [ "$SUITE_NAME" = "dark-mode" ]; then
  xcrun simctl ui booted appearance light 2>/dev/null || true
fi

TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo ""

if [ "$SKIP_COUNT" -gt 0 ]; then
  echo -e "${YELLOW}⊘ $SKIP_COUNT skipped: their fixture is not seeded${NC}"
fi
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✅ $SUITE_NAME: $TOTAL/$TOTAL passed${NC}"
else
  echo -e "${RED}${BOLD}❌ $SUITE_NAME: $PASS_COUNT/$TOTAL passed ($FAIL_COUNT failed)${NC}"
  for test in "${FAILED_TESTS[@]}"; do
    echo -e "${RED}  • $test${NC}"
  done
fi

echo ""
echo "Results: $RESULTS_DIR"

[ "$FAIL_COUNT" -eq 0 ]
