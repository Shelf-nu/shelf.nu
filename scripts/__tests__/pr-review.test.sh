#!/usr/bin/env bash
#
# Test suite for the PR review loop scripts.
#
# Run: pnpm test:tooling   (or: bash scripts/__tests__/pr-review.test.sh)
#
# Activates the `gh` stub by prepending scripts/__tests__/bin to PATH, then
# sources the scripts under test in library mode so individual functions can
# be exercised in isolation.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="$ROOT/scripts/__tests__/bin:$PATH"
export PR_REVIEW_REPO="Shelf-nu/shelf.nu"

PASS=0
FAIL=0

assert_eq() {
  local expected="$1" actual="$2" msg="$3"
  if [[ "$expected" == "$actual" ]]; then
    PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$msg"
  else
    FAIL=$((FAIL + 1))
    printf '  \033[31m✗\033[0m %s\n    expected: %s\n    actual:   %s\n' \
      "$msg" "$expected" "$actual"
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" msg="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$msg"
  else
    FAIL=$((FAIL + 1))
    printf '  \033[31m✗\033[0m %s\n    %s\n    not found in: %.200s\n' \
      "$msg" "$needle" "$haystack"
  fi
}

# Assert a jq filter over a JSON string equals an expected scalar.
assert_json_eq() {
  local expected="$1" json="$2" filter="$3" msg="$4"
  assert_eq "$expected" "$(printf '%s' "$json" | jq -r "$filter")" "$msg"
}

describe() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# --- harness self-test ------------------------------------------------------
describe "harness"
assert_eq "ok" "ok" "assert_eq compares equal strings"
assert_contains "hello world" "lo wo" "assert_contains finds a substring"
assert_json_eq "14" \
  "$(cat "$ROOT/scripts/__tests__/fixtures/pr2770/threads.json")" \
  '.data.repository.pullRequest.reviewThreads.nodes|length' \
  "pr2770 fixture has 14 review threads"
assert_json_eq "4" \
  "$(cat "$ROOT/scripts/__tests__/fixtures/unresolved/threads.json")" \
  '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false)]|length' \
  "unresolved fixture has 4 unresolved threads"

# --- watch: library ---------------------------------------------------------
describe "pr-review-watch: bot detection"

PR_REVIEW_WATCH_LIB_ONLY=1 . "$ROOT/scripts/pr-review-watch.sh"

is_bot "coderabbitai[bot]"          && r=bot || r=human
assert_eq "bot" "$r" "REST spelling coderabbitai[bot] is a bot"

is_bot "coderabbitai"               && r=bot || r=human
assert_eq "bot" "$r" "GraphQL spelling coderabbitai is a bot"

is_bot "chatgpt-codex-connector"    && r=bot || r=human
assert_eq "bot" "$r" "codex is a bot"

is_bot "copilot-pull-request-reviewer[bot]" && r=bot || r=human
assert_eq "bot" "$r" "copilot is a bot"

is_bot "DonKoko"                    && r=bot || r=human
assert_eq "human" "$r" "DonKoko is not a bot"

describe "pr-review-watch: fingerprinting"

CR_BODY='Some finding.
<!-- cr-comment:v1:13e186b6493174b53cbcc5ef -->
Useful? React with 👍 / 👎.'
assert_eq "cr-comment:v1:13e186b6493174b53cbcc5ef" \
  "$(finding_fingerprint "coderabbitai" "a.ts" "$CR_BODY")" \
  "CodeRabbit cr-comment marker is used verbatim as the fingerprint"

# Two renderings of the same Codex finding differing only in badge markup,
# line references, and the react-boilerplate must fingerprint identically.
A='**![P1 Badge](https://img.shields.io/badge/P1-orange)** Fix the guard

around lines 56 - 78 the predicate is inclusive.

Useful? React with 👍 / 👎.'
B='**![P1 Badge](https://img.shields.io/badge/P1-red)** Fix the guard

around lines 61 - 83 the predicate is inclusive.

Useful? React with 👍 / 👎.'
assert_eq "$(finding_fingerprint "chatgpt-codex-connector" "a.ts" "$A")" \
          "$(finding_fingerprint "chatgpt-codex-connector" "a.ts" "$B")" \
  "same finding re-rendered at different lines fingerprints identically"

assert_eq "false" \
  "$([[ "$(finding_fingerprint "codex" "a.ts" "$A")" == "$(finding_fingerprint "codex" "b.ts" "$A")" ]] \
     && echo true || echo false)" \
  "same text on a different file fingerprints differently"

describe "pr-review-watch: state"

TMP_STATE="$(mktemp -d)"
GIT_COMMON_DIR="$TMP_STATE"
state_init 9999 "test-branch"
assert_eq "9999" "$(state_read 9999 | jq -r '.pr')" "state_init writes the PR number"
assert_eq "true" "$(state_read 9999 | jq -r '.copilotExpected')" "copilotExpected defaults to true"
assert_eq "0"    "$(state_read 9999 | jq -r '.round')" "round starts at 0"

state_read 9999 | jq '.round = 3' | state_write 9999
assert_eq "3" "$(state_read 9999 | jq -r '.round')" "state_write round-trips"

state_init 9999 "test-branch"
assert_eq "3" "$(state_read 9999 | jq -r '.round')" "state_init is idempotent, does not clobber"

# Regression (fix round 1): state_write must reject invalid JSON instead of
# letting a dead upstream producer's empty/garbage output clobber good state.
printf 'not json' | state_write 9999
WRITE_RC=$?
assert_eq "1" "$WRITE_RC" "state_write returns non-zero on invalid JSON"
assert_eq "3" "$(state_read 9999 | jq -r '.round')" \
  "state_write leaves prior state intact when given invalid JSON"

# Regression: valid JSON still round-trips — guards against the new
# validation being too aggressive and rejecting well-formed writes.
state_read 9999 | jq '.round = 7' | state_write 9999
WRITE_RC=$?
assert_eq "0" "$WRITE_RC" "state_write returns success on valid JSON"
assert_eq "7" "$(state_read 9999 | jq -r '.round')" "state_write round-trips valid JSON"

# Regression (fix round 2): `jq empty` — and a bare -s size check — both
# accept whitespace-only, `null`, and array payloads, which a dead or
# typo'd upstream producer (e.g. `jq '.nonexistant'` emitting `null`) can
# legitimately emit. Only requiring the parsed top-level type to be
# "object" catches all three; each must be rejected with prior state intact.
printf '   \n' | state_write 9999
WRITE_RC=$?
assert_eq "1" "$WRITE_RC" "state_write rejects a whitespace-only payload"
assert_eq "7" "$(state_read 9999 | jq -r '.round')" \
  "state_write leaves prior state intact on a whitespace-only payload"

printf 'null' | state_write 9999
WRITE_RC=$?
assert_eq "1" "$WRITE_RC" "state_write rejects a null payload"
assert_eq "7" "$(state_read 9999 | jq -r '.round')" \
  "state_write leaves prior state intact on a null payload"

printf '[1,2,3]' | state_write 9999
WRITE_RC=$?
assert_eq "1" "$WRITE_RC" "state_write rejects an array payload"
assert_eq "7" "$(state_read 9999 | jq -r '.round')" \
  "state_write leaves prior state intact on an array payload"

# Regression: state_init must self-heal a file that exists but is empty or
# corrupt (e.g. truncated by a killed writer), not trust it forever.
printf '' > "$(state_path 9999)"
state_init 9999 "test-branch"
assert_eq "9999" "$(state_read 9999 | jq -r '.pr')" \
  "state_init rebuilds an existing but empty state file"
assert_eq "0" "$(state_read 9999 | jq -r '.round')" \
  "state_init's rebuild restores default fields (round back to 0)"

printf 'not json' > "$(state_path 9999)"
state_init 9999 "test-branch"
assert_eq "9999" "$(state_read 9999 | jq -r '.pr')" \
  "state_init rebuilds an existing but corrupt (non-JSON) state file"

rm -rf "$TMP_STATE"

# --- summary ----------------------------------------------------------------
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
