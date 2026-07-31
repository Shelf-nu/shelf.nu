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
# accept zero-byte, whitespace-only, `null`, and array payloads, which a
# dead or typo'd upstream producer (e.g. a filter that emits nothing, or
# `jq '.nonexistant'` emitting `null`) can legitimately produce. Only
# requiring the parsed top-level type to be "object" catches all four; each
# must be rejected with prior state intact.
printf '' | state_write 9999
WRITE_RC=$?
assert_eq "1" "$WRITE_RC" "state_write rejects an empty (zero-byte) payload"
assert_eq "7" "$(state_read 9999 | jq -r '.round')" \
  "state_write leaves prior state intact on an empty (zero-byte) payload"

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

describe "pr-review-watch: thread collection"

export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/unresolved"

RAW="$(collect_threads 2770)"
assert_json_eq "14" "$RAW" 'length' "collect_threads returns all 14 threads"

FINDINGS="$(printf '%s' "$RAW" | shape_findings)"
assert_json_eq "4" "$FINDINGS" 'length' "shape_findings keeps only unresolved threads"
assert_json_eq "4" "$FINDINGS" '[.[]|select(.kind=="bot")]|length' \
  "all four unresolved threads are classified as bot"
assert_json_eq "0" "$FINDINGS" '[.[]|select(.fingerprint=="")]|length' \
  "every finding gets a non-empty fingerprint"
assert_json_eq "0" "$FINDINGS" '[.[]|select(.threadId|startswith("PRRT_")|not)]|length' \
  "every finding carries a PRRT_ thread id"

assert_eq "15a4e0a58707a8db432eba9ac4e3b5e31d136b7c" "$(head_sha 2770)" \
  "head_sha reads headRefOid from the GraphQL response"

# Resolved threads must never surface, or the loop re-answers closed threads.
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
assert_json_eq "0" "$(collect_threads 2770 | shape_findings)" 'length' \
  "a fully-resolved PR yields zero findings"

describe "pr-review-watch: auxiliary sources"

export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
REVIEWS="$(collect_reviews 2770)"
assert_json_eq "20" "$REVIEWS" 'length' "collect_reviews returns all 20 reviews"

copilot_quota_exhausted "$REVIEWS" && r=exhausted || r=ok
assert_eq "exhausted" "$r" "Copilot quota-limit body is detected on #2770"

OOD="$(out_of_diff_reviews "$REVIEWS")"
assert_json_eq "3" "$OOD" 'length' \
  "three reviews carry out-of-diff findings invisible to thread polling"

# Codex publishes its reviewed SHA; CodeRabbit does not and falls back to a
# timestamp marker. Both must appear in the map.
RH="$(reviewed_head_map "$REVIEWS" "2026-07-30T00:00:00Z")"
assert_json_eq "a3293f170e" "$RH" '."chatgpt-codex-connector[bot]"' \
  "codex reviewed-SHA is parsed from its review body"
assert_json_eq "timestamp" "$RH" '."coderabbitai[bot]"' \
  "coderabbit has no SHA marker and falls back to timestamp matching"

CHECKS="$(collect_checks 15a4e0a58707a8db432eba9ac4e3b5e31d136b7c)"
assert_json_eq "0" "$CHECKS" '.red'     "no red checks on the #2770 fixture"
assert_json_eq "0" "$CHECKS" '.pending' "no pending checks on the #2770 fixture"

# The #2770 payload is all-green, so the two assertions above would ALSO pass
# against a collect_checks hardcoded to return {red:0,pending:0} — they prove
# nothing about the counting logic. This fixture is the one that does.
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/checks-mixed"
MIXED="$(collect_checks deadbeef)"
assert_json_eq "2" "$MIXED" '.red' \
  "red counts failure + action_required (not neutral/skipped/success)"
assert_json_eq "1" "$MIXED" '.pending' \
  "pending counts any run whose status is not completed"
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"

describe "pr-review-watch: dedup and events"

export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/unresolved"
TMP_STATE="$(mktemp -d)"; GIT_COMMON_DIR="$TMP_STATE"
state_init 2770 "test-branch"

FINDINGS="$(collect_threads 2770 | shape_findings)"
FRESH="$(unseen_findings "$FINDINGS" "$(state_read 2770)")"
assert_json_eq "4" "$FRESH" 'length' "all four findings are unseen on a fresh state"

# Record a verdict for the first fingerprint, then re-run.
FP="$(printf '%s' "$FINDINGS" | jq -r '.[0].fingerprint')"
state_read 2770 | jq --arg fp "$FP" \
  '.seen[$fp] = {verdict:"FALSE_POSITIVE", decidedInRound:1, reposts:1}' \
  | state_write 2770
FRESH="$(unseen_findings "$FINDINGS" "$(state_read 2770)")"
assert_json_eq "3" "$FRESH" 'length' "a decided fingerprint is not re-triaged"

# A VALID (already-fixed) verdict must ALSO suppress re-triage — a bot
# re-flagging fixed work is at least as common as one re-flagging a rejection.
FP2="$(printf '%s' "$FINDINGS" | jq -r '.[1].fingerprint')"
state_read 2770 | jq --arg fp "$FP2" \
  '.seen[$fp] = {verdict:"VALID", decidedInRound:1, reposts:1, resolvedSha:"abc1234"}' \
  | state_write 2770
FRESH="$(unseen_findings "$FINDINGS" "$(state_read 2770)")"
assert_json_eq "2" "$FRESH" 'length' "an already-fixed fingerprint is not re-triaged"

assert_eq "1" "$(repost_count "$FP" "$(state_read 2770)")" "repost_count reads the counter"
assert_eq "0" "$(repost_count "nonexistent" "$(state_read 2770)")" \
  "repost_count is 0 for an unknown fingerprint"

describe "pr-review-watch: event emission"

EV="$(emit NEW_FINDINGS '{"count":3}')"
assert_json_eq "NEW_FINDINGS" "$EV" '.event' "emit sets the event name"
assert_json_eq "3" "$EV" '.count' "emit merges the payload"
# Pipe emit's output directly to wc -l rather than routing it through a
# captured variable first: command substitution strips the trailing newline,
# so counting newlines in a re-captured variable only counts EMBEDDED
# newlines (0 for correct single-line output, 1 for a two-line bug) — the
# inverse of what we want to assert.
assert_eq "1" "$(emit NEW_FINDINGS '{"count":3}' | wc -l | tr -d ' ')" \
  "emit writes exactly one line — every line becomes a chat notification"

describe "pr-review-watch: poll_once emission"

# poll_once is the function the whole script exists to run, and it had no
# coverage at all — `poll_once() { return 0; }` passed the entire suite. These
# assertions drive MULTI-POLL sequences, because every defect this section
# guards against is invisible to a single poll.

export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/unresolved"
detect_push() { printf ''; }   # test seam: keep poll_once off git/network

state_init 5001 "test-branch"
POLL1="$(poll_once 5001)"
POLL2="$(poll_once 5001)"
POLL3="$(poll_once 5001)"

assert_eq "1" "$(printf '%s\n' "$POLL1" | grep -c '"event":"NEW_FINDINGS"')" \
  "NEW_FINDINGS is announced on the first poll"
assert_eq "0" "$(printf '%s\n' "$POLL2" | grep -c '"event":"NEW_FINDINGS"')" \
  "NEW_FINDINGS is not repeated while the same findings stay undecided"
assert_eq "0" "$(printf '%s\n' "$POLL3" | grep -c '"event":"NEW_FINDINGS"')" \
  "NEW_FINDINGS stays quiet on a third poll"
assert_eq "0" "$(printf '%s\n' "$POLL1" | grep -c '"event":"PUSHED"')" \
  "no PUSHED event is announced when nothing was pushed"

# A PR whose threads are ALL resolved still carries out-of-diff findings, and
# they have no thread to surface them. If this regresses, the loop goes quiet
# while real findings sit unhandled — the failure this event exists to prevent.
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
state_init 5002 "test-branch"
OOD1="$(poll_once 5002)"
OOD2="$(poll_once 5002)"

assert_eq "0" "$(printf '%s\n' "$OOD1" | grep -c '"event":"NEW_FINDINGS"')" \
  "no NEW_FINDINGS when every thread is resolved"
assert_eq "1" "$(printf '%s\n' "$OOD1" | grep -c '"event":"OUT_OF_DIFF"')" \
  "out-of-diff findings are announced even with zero fresh bot threads"
assert_eq "0" "$(printf '%s\n' "$OOD2" | grep -c '"event":"OUT_OF_DIFF"')" \
  "out-of-diff findings are not re-announced on the next poll"

# A persistently red check must notify once, not once per minute forever.
collect_checks() { printf '{"red":2,"pending":1}'; }
state_init 5003 "test-branch"
RED1="$(poll_once 5003)"
RED2="$(poll_once 5003)"

assert_eq "1" "$(printf '%s\n' "$RED1" | grep -c '"event":"CHECKS_RED"')" \
  "CHECKS_RED is announced when checks first go red"
assert_eq "0" "$(printf '%s\n' "$RED2" | grep -c '"event":"CHECKS_RED"')" \
  "CHECKS_RED is not repeated while checks stay red"

# A rejected state write must withhold the buffered events. Announcing a
# transition whose record failed to persist re-fires it on every later poll.
WITHHELD="$(
  state_write() { return 1; }
  state_init 5004 "test-branch"
  poll_once 5004
)"
assert_eq "0" "$(printf '%s\n' "$WITHHELD" | grep -c '"event":"COPILOT_QUOTA"')" \
  "buffered events are withheld when the state write is rejected"
assert_eq "1" "$(printf '%s\n' "$WITHHELD" | grep -c '"event":"ERROR"')" \
  "a rejected state write reports an ERROR event"

# A finding that is announced, never decided, disappears, and is re-posted
# must speak again. `announced` outliving the finding was how the original
# "actionable thing exists, no event emitted" bug got reintroduced by the
# very guard added to stop repeat notifications.
state_init 5005 "test-branch"
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/unresolved"
GONE1="$(poll_once 5005)"                                   # 4 findings arrive
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
GONE2="$(poll_once 5005)"                                   # bot resolves them
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/unresolved"
GONE3="$(poll_once 5005)"                                   # bot re-posts them

assert_eq "1" "$(printf '%s\n' "$GONE1" | grep -c '"event":"NEW_FINDINGS"')" \
  "findings are announced when they first appear"
assert_eq "0" "$(printf '%s\n' "$GONE2" | grep -c '"event":"NEW_FINDINGS"')" \
  "nothing announced when the findings disappear"
assert_eq "1" "$(printf '%s\n' "$GONE3" | grep -c '"event":"NEW_FINDINGS"')" \
  "an undecided finding that vanished and returned is announced again"

assert_eq "0" "$(state_read 5005 | jq '.seen | length')" \
  "the vanish/return cycle never wrote a verdict — these are still unjudged"

# A persistent fault must report once, not once per poll.
LAST_ERROR=""
emit_error_once "boom" >/dev/null
assert_eq "0" "$(emit_error_once "boom" | wc -c | tr -d ' ')" \
  "a repeated identical error is not re-emitted"
assert_eq "1" "$(emit_error_once "different" | wc -l | tr -d ' ')" \
  "a distinct error is still reported"
LAST_ERROR=""

unset -f detect_push collect_checks
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"

rm -rf "$TMP_STATE"

describe "pr-review-respond"

TMP_D="$(mktemp -d)"

# EXPORT, not a plain assignment: pr-review-respond.sh runs as a SUBPROCESS,
# so it only sees the isolated git dir if the variable is in its environment.
# Without this the idempotency ledger is written into the real repository's
# .git, which (a) mutates the developer's checkout from a test run and (b)
# makes the suite non-re-runnable — the second run finds the previous run's
# ledger entries and suppresses every reply, failing "one reply mutation per
# decision" with 0 instead of 3.
export GIT_COMMON_DIR="$TMP_D/git"
mkdir -p "$GIT_COMMON_DIR"
cat > "$TMP_D/decisions.json" <<'JSON'
[
  {"threadId":"PRRT_aaa","replyBody":"Fixed in abc1234 — tightened the guard.","resolve":true},
  {"threadId":"PRRT_bbb","replyBody":"Not applying — conflicts with a lint rule.","resolve":true},
  {"threadId":"PRRT_ccc","replyBody":"Fixed in abc1234 — see above.","resolve":false}
]
JSON

DRY="$(bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$TMP_D/decisions.json" --dry-run)"
assert_contains "$DRY" "PRRT_aaa" "dry run reports the first thread"
assert_contains "$DRY" "reply+resolve" "dry run labels a reply+resolve decision"
assert_contains "$DRY" "reply-only"    "dry run labels a reply-only decision"

export GH_MUTATION_LOG="$TMP_D/mutations.log"
: > "$GH_MUTATION_LOG"
bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$TMP_D/decisions.json" >/dev/null

assert_eq "3" "$(grep -c 'addPullRequestReviewThreadReply' "$GH_MUTATION_LOG")" \
  "one reply mutation per decision"
assert_eq "2" "$(grep -c 'resolveReviewThread' "$GH_MUTATION_LOG")" \
  "resolve only for decisions with resolve:true"

# Re-running must not double-post: replies are the outward-facing side effect.
: > "$GH_MUTATION_LOG"
bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$TMP_D/decisions.json" >/dev/null
assert_eq "0" "$(grep -c 'addPullRequestReviewThreadReply' "$GH_MUTATION_LOG")" \
  "re-running the same decisions posts nothing (idempotent)"

# The asymmetry is the whole point and must be pinned, not just described:
# the reply is suppressed on a re-run, but the resolve still fires. Without
# this assertion a refactor that moved resolve_mutation inside the else
# branch would pass the suite while quietly leaving threads open forever.
assert_eq "2" "$(grep -c 'resolveReviewThread' "$GH_MUTATION_LOG")" \
  "re-running still resolves (harmless no-op) even though it posts no reply"

# A reply that FAILS must not leave the thread resolved. Resolving without a
# reply marks a live PR thread "addressed" with no explanation on it.
: > "$GH_MUTATION_LOG"
FAILDIR="$TMP_D/failbin"; mkdir -p "$FAILDIR"
cat > "$FAILDIR/gh" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
args="$*"
[[ -n "${GH_MUTATION_LOG:-}" ]] && printf '%s\n' "$args" >> "$GH_MUTATION_LOG"
case "$args" in
  *addPullRequestReviewThreadReply*) exit 1 ;;   # simulate a failed reply
  *) printf '{"data":{"ok":true}}\n' ;;
esac
STUB
chmod +x "$FAILDIR/gh"
cat > "$TMP_D/one.json" <<'JSON'
[{"threadId":"PRRT_zzz","replyBody":"Fixed in deadbee — tightened the guard.","resolve":true}]
JSON
FAIL_RC=0
PATH="$FAILDIR:$PATH" bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$TMP_D/one.json" \
  >/dev/null 2>&1 || FAIL_RC=$?

assert_eq "1" "$FAIL_RC" "a failed reply makes the script exit non-zero"
assert_eq "0" "$(grep -c 'resolveReviewThread' "$GH_MUTATION_LOG")" \
  "a thread whose reply failed is NOT resolved"

# An unrecognized third argument must abort, never fall through to a live run.
BAD_RC=0
bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$TMP_D/decisions.json" --dryrun \
  >/dev/null 2>&1 || BAD_RC=$?
assert_eq "2" "$BAD_RC" "a mistyped --dry-run flag aborts instead of running live"

rm -rf "$TMP_D"
unset GH_MUTATION_LOG GIT_COMMON_DIR

# --- summary ----------------------------------------------------------------
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
