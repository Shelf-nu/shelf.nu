#!/usr/bin/env bash
set -euo pipefail

#############################################################################
# Maestro E2E Test Runner — Full Suite
#
# Runs all test suites sequentially, collects simulator logs,
# generates a report, and appends to LESSONS.md.
#
# Usage:
#   ./run-all.sh                   # Run all suites
#   SKIP_DARK=1 ./run-all.sh       # Skip dark mode suite
#############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAESTRO_DIR="$(dirname "$SCRIPT_DIR")"
MOBILE_DIR="$(dirname "$MAESTRO_DIR")"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_DIR="$MAESTRO_DIR/results/$TIMESTAMP"

# Ensure Java + Maestro are on PATH
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH:$HOME/.maestro/bin"

# Suppress Maestro analytics + notifications
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}${BOLD}  Shelf Mobile — Maestro E2E Test Runner${NC}"
echo -e "${CYAN}${BOLD}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════${NC}"
echo ""

# ─── Load environment variables ─────────────────────────────────────
ENV_FILE="$MAESTRO_DIR/env/test.env"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}✗ Missing env file: $ENV_FILE${NC}"
  echo "  Copy env/test.env.example to env/test.env and fill in values."
  exit 1
fi

# Build Maestro -e flags from env file
# Maestro doesn't reliably read shell env vars; use -e flag instead
MAESTRO_ENV_FLAGS=()
while IFS='=' read -r key value; do
  # Skip comments and empty lines
  [[ -z "$key" || "$key" == \#* ]] && continue
  # Strip quotes from value
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  MAESTRO_ENV_FLAGS+=(-e "$key=$value")
  # Also export for report generation
  export "$key=$value"
done < "$ENV_FILE"
echo -e "${GREEN}✓ Loaded ${#MAESTRO_ENV_FLAGS[@]} env vars from test.env${NC}"

# ─── Verify Maestro is installed ────────────────────────────────────
if ! command -v maestro &>/dev/null; then
  echo -e "${RED}✗ Maestro not found. Install with: curl -Ls 'https://get.maestro.mobile.dev' | bash${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Maestro $(maestro --version 2>/dev/null | tail -1)${NC}"

# ─── Boot iOS simulator if needed ───────────────────────────────────
SIMULATOR_NAME="iPhone 15 Pro Max"
BOOTED=$(xcrun simctl list devices booted 2>/dev/null | grep -c "Booted" || true)
if [ "$BOOTED" -eq 0 ]; then
  echo -e "${YELLOW}  Booting simulator: $SIMULATOR_NAME...${NC}"
  xcrun simctl boot "$SIMULATOR_NAME" 2>/dev/null || true
  sleep 5
fi
echo -e "${GREEN}✓ iOS Simulator ready${NC}"

# Clear iOS Keychain to reset SecureStore auth tokens
# (clearState only clears AsyncStorage, not Keychain)
xcrun simctl keychain booted reset 2>/dev/null || true
echo -e "${GREEN}✓ Keychain reset (SecureStore cleared)${NC}"

# ─── Create results directory ───────────────────────────────────────
mkdir -p "$RESULTS_DIR"
echo -e "${GREEN}✓ Results dir: $RESULTS_DIR${NC}"

# ─── Start simulator log collection ────────────────────────────────
LOG_FILE="$RESULTS_DIR/simulator.log"
xcrun simctl spawn booted log stream --level=debug --predicate 'processImagePath CONTAINS "Shelf"' > "$LOG_FILE" 2>&1 &
LOG_PID=$!
echo -e "${GREEN}✓ Simulator log collection started (PID: $LOG_PID)${NC}"
echo ""

# ─── Define test suites ────────────────────────────────────────────
SUITES=(auth dashboard assets scanner bookings audits settings)
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
TOTAL_COUNT=0
FAILED_TESTS=()
SUITE_RESULTS=()

# ─── Run each suite ────────────────────────────────────────────────
for suite in "${SUITES[@]}"; do
  SUITE_DIR="$MAESTRO_DIR/flows/$suite"
  if [ ! -d "$SUITE_DIR" ]; then
    echo -e "${YELLOW}⊘ Skipping: $suite (directory not found)${NC}"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    continue
  fi

  echo -e "${CYAN}${BOLD}━━━ Running: $suite ━━━${NC}"
  SUITE_PASS=0
  SUITE_FAIL=0

  for flow in "$SUITE_DIR"/*.yaml; do
    [ -f "$flow" ] || continue
    FLOW_NAME=$(basename "$flow" .yaml)
    TOTAL_COUNT=$((TOTAL_COUNT + 1))

    echo -n "  ▸ $FLOW_NAME ... "

    FLOW_OUTPUT="$RESULTS_DIR/${suite}_${FLOW_NAME}.log"
    if maestro test "${MAESTRO_ENV_FLAGS[@]}" "$flow" --output "$RESULTS_DIR" > "$FLOW_OUTPUT" 2>&1; then
      echo -e "${GREEN}PASS${NC}"
      PASS_COUNT=$((PASS_COUNT + 1))
      SUITE_PASS=$((SUITE_PASS + 1))
    else
      echo -e "${RED}FAIL${NC}"
      FAIL_COUNT=$((FAIL_COUNT + 1))
      SUITE_FAIL=$((SUITE_FAIL + 1))
      FAILED_TESTS+=("$suite/$FLOW_NAME")
    fi
  done

  SUITE_RESULTS+=("$suite: $SUITE_PASS passed, $SUITE_FAIL failed")
  echo ""
done

# ─── Dark mode suite (optional) ────────────────────────────────────
if [ "${SKIP_DARK:-}" != "1" ]; then
  DARK_DIR="$MAESTRO_DIR/flows/dark-mode"
  if [ -d "$DARK_DIR" ]; then
    echo -e "${CYAN}${BOLD}━━━ Running: dark-mode ━━━${NC}"

    # Set simulator to dark mode
    xcrun simctl ui booted appearance dark 2>/dev/null || true
    SUITE_PASS=0
    SUITE_FAIL=0

    for flow in "$DARK_DIR"/*.yaml; do
      [ -f "$flow" ] || continue
      FLOW_NAME=$(basename "$flow" .yaml)
      TOTAL_COUNT=$((TOTAL_COUNT + 1))

      echo -n "  ▸ $FLOW_NAME ... "

      FLOW_OUTPUT="$RESULTS_DIR/dark-mode_${FLOW_NAME}.log"
      if maestro test "${MAESTRO_ENV_FLAGS[@]}" "$flow" --output "$RESULTS_DIR" > "$FLOW_OUTPUT" 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        PASS_COUNT=$((PASS_COUNT + 1))
        SUITE_PASS=$((SUITE_PASS + 1))
      else
        echo -e "${RED}FAIL${NC}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        SUITE_FAIL=$((SUITE_FAIL + 1))
        FAILED_TESTS+=("dark-mode/$FLOW_NAME")
      fi
    done

    SUITE_RESULTS+=("dark-mode: $SUITE_PASS passed, $SUITE_FAIL failed")

    # Reset simulator back to light mode
    xcrun simctl ui booted appearance light 2>/dev/null || true
    echo ""
  fi
fi

# ─── Stop log collection ───────────────────────────────────────────
kill "$LOG_PID" 2>/dev/null || true
echo -e "${GREEN}✓ Simulator log collection stopped${NC}"

# ─── Generate report ───────────────────────────────────────────────
REPORT_FILE="$RESULTS_DIR/REPORT.md"
cat > "$REPORT_FILE" <<EOF
# Maestro E2E Test Report

**Date:** $(date '+%Y-%m-%d %H:%M:%S')
**Platform:** iOS Simulator ($SIMULATOR_NAME)
**Maestro:** $(maestro --version 2>/dev/null | tail -1)

## Summary

| Metric | Count |
|--------|-------|
| Total  | $TOTAL_COUNT |
| Passed | $PASS_COUNT |
| Failed | $FAIL_COUNT |
| Skipped | $SKIP_COUNT |

## Suite Results

$(for result in "${SUITE_RESULTS[@]}"; do echo "- $result"; done)

EOF

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  cat >> "$REPORT_FILE" <<EOF
## Failed Tests

$(for test in "${FAILED_TESTS[@]}"; do echo "- \`$test\`"; done)

EOF
fi

cat >> "$REPORT_FILE" <<EOF
## Environment

- Email: ${SHELF_TEST_EMAIL:-"(not set)"}
- Asset ID: ${SHELF_TEST_ASSET_ID:-"(not set)"}
- Booking ID: ${SHELF_TEST_BOOKING_ID:-"(not set)"}
- Audit ID: ${SHELF_TEST_AUDIT_ID:-"(not set)"}
- QR ID: ${SHELF_TEST_QR_ID:-"(not set)"}

## Files

- Report: \`$REPORT_FILE\`
- Simulator Log: \`simulator.log\`
- Screenshots: \`*.png\` files in this directory
- Flow Logs: \`*_*.log\` files in this directory
EOF

echo -e "${GREEN}✓ Report: $REPORT_FILE${NC}"

# ─── Append to LESSONS.md ──────────────────────────────────────────
LESSONS_FILE="$MAESTRO_DIR/LESSONS.md"
cat >> "$LESSONS_FILE" <<EOF

---

## Run: $(date '+%Y-%m-%d %H:%M:%S')

**Result:** $PASS_COUNT/$TOTAL_COUNT passed ($FAIL_COUNT failed, $SKIP_COUNT skipped)

$(if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo "**Failed:**"
  for test in "${FAILED_TESTS[@]}"; do echo "- \`$test\`"; done
fi)

**Observations:**
- <!-- Add observations here -->

**Opportunities:**
- <!-- Add improvement ideas here -->

EOF

echo -e "${GREEN}✓ LESSONS.md updated${NC}"
echo ""

# ─── Final summary ─────────────────────────────────────────────────
echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════${NC}"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}  ✅ ALL $TOTAL_COUNT TESTS PASSED${NC}"
else
  echo -e "${RED}${BOLD}  ❌ $FAIL_COUNT/$TOTAL_COUNT TESTS FAILED${NC}"
  echo ""
  echo -e "${RED}  Failed tests:${NC}"
  for test in "${FAILED_TESTS[@]}"; do
    echo -e "${RED}    • $test${NC}"
  done
fi
echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════${NC}"
echo ""
echo "Results saved to: $RESULTS_DIR"

# Exit with failure code if any tests failed
[ "$FAIL_COUNT" -eq 0 ]
