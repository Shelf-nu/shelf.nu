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

# Test-only helper simulating what the SKILL does when it records a verdict.
# The script under test must never write decisions.json itself — decisions_read
# is its only access to that file (single-writer-per-file) — so this exists
# purely to seed fixtures for these tests.
#
# Atomic tmp+mv, matching state_write's pattern — NOT optional here. A plain
# `cat > "$p"` truncates the target the instant the redirect opens, which
# races a concurrent `decisions_read "$pr" | jq ... | decisions_write "$pr"`
# pipeline: bash starts every stage of a pipe at once, so decisions_read can
# open the SAME path mid-truncation and read back empty/partial content.
# Verified empirically — flaky, timing-dependent data loss, not a one-off.
decisions_write() {
  local p tmp; p="$(decisions_path "$1")"
  mkdir -p "$(dirname "$p")"
  tmp="$(mktemp "${p}.XXXXXX")"
  cat > "$tmp"
  mv "$tmp" "$p"
}

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

# The unresolved fixture's four open threads each carry exactly two
# comments: the bot's original finding, then a HUMAN ("DonKoko") reply —
# "Fixed in 779fb60b — ...". shape_findings must surface BOTH as their own
# findings, not just comments.nodes[0] — otherwise the human's reply is
# invisible to unseen_findings/quiescence and the thread can be auto-answered
# and resolved off the bot's stale verdict without the human ever being seen.
FINDINGS="$(printf '%s' "$RAW" | shape_findings)"
assert_json_eq "8" "$FINDINGS" 'length' \
  "shape_findings surfaces every comment (4 threads x 2 comments), not just comments.nodes[0]"
assert_json_eq "4" "$FINDINGS" '[.[]|select(.kind=="bot")]|length' \
  "the four original bot findings are still classified as bot"
assert_json_eq "4" "$FINDINGS" '[.[]|select(.kind=="human")]|length' \
  "the four human follow-up replies are now surfaced too, classified as human"
assert_json_eq "4" "$FINDINGS" \
  '[.[]|select(.kind=="human")|select(.body|test("Fixed in 779fb60b"))]|length' \
  "the human replies carry their OWN body text, not the bot's original finding"
assert_json_eq "0" "$FINDINGS" '[.[]|select(.fingerprint=="")]|length' \
  "every finding gets a non-empty fingerprint"
assert_json_eq "0" "$FINDINGS" '[.[]|select(.threadId|startswith("PRRT_")|not)]|length' \
  "every finding carries a PRRT_ thread id"
assert_json_eq "4" "$FINDINGS" \
  '[group_by(.threadId)[]|select(length==2)]|length' \
  "each thread's two comments share the same threadId — a reply is scoped to its own thread"

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

# gh's REST list endpoints default to ~30 items/page; a PR with more reviews
# or issue comments than that would silently lose everything past page 1
# without `--paginate`. The shared fixture stub can't reveal a missing flag
# on its own (it serves the same fixture file regardless of args), so this
# uses a local, single-purpose stub — matching the FAILDIR/RESOLVEFAILDIR
# pattern used later in this file for pr-review-respond — that logs the
# exact invocation instead of serving a fixture.
PAGINATE_BIN="$(mktemp -d)"
PAGINATE_LOG="$PAGINATE_BIN/calls.log"
cat > "$PAGINATE_BIN/gh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GH_PAGINATE_LOG"
printf '[]\n'
STUB
chmod +x "$PAGINATE_BIN/gh"
GH_PAGINATE_LOG="$PAGINATE_LOG" PATH="$PAGINATE_BIN:$PATH" collect_reviews 2770 >/dev/null
GH_PAGINATE_LOG="$PAGINATE_LOG" PATH="$PAGINATE_BIN:$PATH" collect_issue_comments 2770 >/dev/null
assert_eq "2" "$(wc -l < "$PAGINATE_LOG" | tr -d ' ')" \
  "collect_reviews and collect_issue_comments each made exactly one gh call"
assert_eq "2" "$(grep -c -- '--paginate' "$PAGINATE_LOG")" \
  "both of those gh calls carry --paginate, not just the first"
rm -rf "$PAGINATE_BIN"

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

# decisions_read must not error before the skill has ever written anything —
# poll_once depends on a fresh PR reading as "nothing decided yet", not a
# hard failure.
assert_eq "{}" "$(decisions_read 2770)" \
  "decisions_read returns an empty object when no decisions.json exists yet"

FRESH="$(unseen_findings "$FINDINGS" "$(decisions_read 2770)")"
assert_json_eq "8" "$FRESH" 'length' "all eight findings are unseen on a fresh decisions doc"

# Record a verdict for the first fingerprint, then re-run. Written to the
# SKILL's own file via decisions_write (a test-only seam) — this script must
# never write decisions.json itself.
FP="$(printf '%s' "$FINDINGS" | jq -r '.[0].fingerprint')"
jq -n --arg fp "$FP" '{seen: {($fp): {verdict:"FALSE_POSITIVE", decidedInRound:1}}}' \
  | decisions_write 2770
FRESH="$(unseen_findings "$FINDINGS" "$(decisions_read 2770)")"
assert_json_eq "7" "$FRESH" 'length' "a decided fingerprint is not re-triaged"

# A VALID (already-fixed) verdict must ALSO suppress re-triage — a bot
# re-flagging fixed work is at least as common as one re-flagging a rejection.
FP2="$(printf '%s' "$FINDINGS" | jq -r '.[1].fingerprint')"
decisions_read 2770 | jq --arg fp "$FP2" \
  '.seen[$fp] = {verdict:"VALID", decidedInRound:1, resolvedSha:"abc1234"}' \
  | decisions_write 2770
FRESH="$(unseen_findings "$FINDINGS" "$(decisions_read 2770)")"
assert_json_eq "6" "$FRESH" 'length' "an already-fixed fingerprint is not re-triaged"

# ESCALATE verdicts live in .escalated[], not .seen — and must ALSO suppress
# re-triage, or the loop re-dispatches a triager for the same finding every
# round.
FP3="$(printf '%s' "$FINDINGS" | jq -r '.[2].fingerprint')"
decisions_read 2770 | jq --arg fp "$FP3" \
  '.escalated += [{fingerprint:$fp, reason:"security-flavored", round:1}]' \
  | decisions_write 2770
FRESH="$(unseen_findings "$FINDINGS" "$(decisions_read 2770)")"
assert_json_eq "5" "$FRESH" 'length' "an escalated fingerprint is not re-dispatched either"

# repost_count reads the WATCHER's OWN map, in state — repostCounts cannot
# live in the skill's decisions.json, because only one component may write
# a given file.
state_read 2770 | jq --arg fp "$FP" '.repostCounts[$fp] = {count:1, threadId:"PRRT_x"}' \
  | state_write 2770
assert_eq "1" "$(repost_count "$FP" "$(state_read 2770)")" "repost_count reads the counter"
assert_eq "0" "$(repost_count "nonexistent" "$(state_read 2770)")" \
  "repost_count is 0 for an unknown fingerprint"

describe "pr-review-watch: repost counter (accumulator, not a frozen snapshot)"

# Regression coverage for the "reposts reducer oscillates" bug: the original
# implementation compared each finding against a FROZEN document instead of
# the reduce's own accumulator, so two open threads sharing one fingerprint
# ticked the counter on EVERY poll, alternating which thread "currently"
# differs. Three polls is three minutes — enough to trip the skill's
# three-repost escalation on a healthy, still-open finding.
DECIDED='{"seen":{"fpX":{"threadId":"PRRT_A","verdict":"FALSE_POSITIVE"}}}'

# Same-fingerprint coexistence is routine — fingerprints deliberately ignore
# line numbers — and the ORIGINALLY DECIDED thread (A) is still open here,
# so nothing has actually reposted yet.
COEXIST='[{"fingerprint":"fpX","threadId":"PRRT_A"},{"fingerprint":"fpX","threadId":"PRRT_B"}]'
RC1="$(advance_repost_counts '{}' "$COEXIST" "$DECIDED")"
assert_eq "0" "$(printf '%s' "$RC1" | jq -r '.fpX.count // 0')" \
  "a decided thread still open alongside a same-fingerprint sibling is not a repost"

RC2="$(advance_repost_counts "$(jq -n --argjson rc "$RC1" '{repostCounts:$rc}')" "$COEXIST" "$DECIDED")"
assert_eq "0" "$(printf '%s' "$RC2" | jq -r '.fpX.count // 0')" \
  "the same coexistence on the next poll still does not tick — the oscillation this guards against"

# The decided thread closes and only the sibling remains — a genuine repost.
CLOSED='[{"fingerprint":"fpX","threadId":"PRRT_B"}]'
RC3="$(advance_repost_counts "$(jq -n --argjson rc "$RC2" '{repostCounts:$rc}')" "$CLOSED" "$DECIDED")"
assert_eq "1" "$(printf '%s' "$RC3" | jq -r '.fpX.count')" \
  "the decided thread closing and a new one appearing ticks the counter once"

RC4="$(advance_repost_counts "$(jq -n --argjson rc "$RC3" '{repostCounts:$rc}')" "$CLOSED" "$DECIDED")"
RC5="$(advance_repost_counts "$(jq -n --argjson rc "$RC4" '{repostCounts:$rc}')" "$CLOSED" "$DECIDED")"
assert_eq "1" "$(printf '%s' "$RC5" | jq -r '.fpX.count')" \
  "repeated polls of a now-settled repost do not keep incrementing the counter"

describe "pr-review-watch: expected_bots (I5)"

assert_eq '["coderabbitai[bot]","chatgpt-codex-connector[bot]","copilot-pull-request-reviewer[bot]"]' \
  "$(expected_bots "true" | jq -c '.')" \
  "expected_bots includes all three review bots when Copilot is expected"
assert_eq '["coderabbitai[bot]","chatgpt-codex-connector[bot]"]' \
  "$(expected_bots "false" | jq -c '.')" \
  "expected_bots excludes Copilot once copilotExpected is false"
assert_eq "0" "$(expected_bots "true" | jq '[.[] | select(. == "github-actions[bot]")] | length')" \
  "expected_bots never includes github-actions — it posts no PR review"

describe "pr-review-watch: compute_quiescent (C2)"

# Every condition satisfied: both expected bots caught up, no pending bot
# findings, every decided finding replied, no open re-post, every
# out-of-diff finding addressed, checks clean.
QSTATE='{"expectedBots":["coderabbitai[bot]","chatgpt-codex-connector[bot]"],
"reviewedHead":{"coderabbitai[bot]":"timestamp","chatgpt-codex-connector[bot]":"a3293f1"},
"headSha":"a3293f170e0000000000000000000000000000",
"headShaFirstSeenAt":"2026-08-03T00:00:00Z","reposted":[]}'
QCHECKS='{"red":0,"pending":0}'
QDECISIONS='{"seen":{},"addressedOutOfDiff":{}}'
QNOW="2026-08-03T00:05:00Z"

assert_eq "true" "$(compute_quiescent "$QSTATE" "$QCHECKS" '[]' '[]' "$QDECISIONS" "$QNOW")" \
  "compute_quiescent is true when every condition holds"

NOT_CAUGHT_UP='{"expectedBots":["coderabbitai[bot]"], "reviewedHead":{},
"headSha":"abc","headShaFirstSeenAt":"2026-08-03T00:00:00Z","reposted":[]}'
assert_eq "false" \
  "$(compute_quiescent "$NOT_CAUGHT_UP" "$QCHECKS" '[]' '[]' "$QDECISIONS" "$QNOW")" \
  "condition #1 blocks quiescence when an expected bot has not caught up"
assert_eq "true" \
  "$(compute_quiescent "$NOT_CAUGHT_UP" "$QCHECKS" '[]' '[]' "$QDECISIONS" "2026-08-03T00:21:00Z")" \
  "the 20-minute stale-bot waiver lets quiescence proceed regardless"

assert_eq "false" \
  "$(compute_quiescent "$QSTATE" "$QCHECKS" '[{"kind":"bot"}]' '[]' "$QDECISIONS" "$QNOW")" \
  "condition #2 blocks quiescence on an undecided pending BOT finding"
assert_eq "true" \
  "$(compute_quiescent "$QSTATE" "$QCHECKS" '[{"kind":"human"}]' '[]' "$QDECISIONS" "$QNOW")" \
  "an open HUMAN thread never blocks quiescence — reported, not resolved"

DEC_UNREPLIED='{"seen":{"fp1":{"replied":false}},"addressedOutOfDiff":{}}'
assert_eq "false" \
  "$(compute_quiescent "$QSTATE" "$QCHECKS" '[]' '[]' "$DEC_UNREPLIED" "$QNOW")" \
  "condition #2 blocks quiescence on a decided-but-not-yet-replied finding — not merely '.pending empty'"

STATE_REPOSTED='{"expectedBots":[], "reviewedHead":{}, "headSha":"abc",
"headShaFirstSeenAt":"2026-08-03T00:00:00Z","reposted":[{"fingerprint":"x"}]}'
assert_eq "false" \
  "$(compute_quiescent "$STATE_REPOSTED" "$QCHECKS" '[]' '[]' "$QDECISIONS" "$QNOW")" \
  "condition #2 blocks quiescence on an open re-post (C1's reposted set)"

assert_eq "false" \
  "$(compute_quiescent "$QSTATE" "$QCHECKS" '[]' '[{"reviewId":123}]' "$QDECISIONS" "$QNOW")" \
  "condition #3 blocks quiescence on an unaddressed out-of-diff finding"
DEC_OOD_DONE='{"seen":{},"addressedOutOfDiff":{"123":true}}'
assert_eq "true" \
  "$(compute_quiescent "$QSTATE" "$QCHECKS" '[]' '[{"reviewId":123}]' "$DEC_OOD_DONE" "$QNOW")" \
  "an addressed out-of-diff finding no longer blocks quiescence"

assert_eq "false" \
  "$(compute_quiescent "$QSTATE" '{"red":1,"pending":0}' '[]' '[]' "$QDECISIONS" "$QNOW")" \
  "condition #4 blocks quiescence on a red check"
assert_eq "false" \
  "$(compute_quiescent "$QSTATE" '{"red":0,"pending":1}' '[]' '[]' "$QDECISIONS" "$QNOW")" \
  "condition #4 blocks quiescence on a still-pending check"

describe "pr-review-watch: UTC-normalized timestamp comparison"

# git emits the COMMITTER'S OWN offset, never "Z" — jq's fromdateiso8601
# cannot parse a numeric offset at all (verified: it rejects both "+03:00"
# and even "+00:00", requiring the literal "Z").
assert_eq "2026-07-30T20:00:00Z" "$(iso8601_to_utc_z "2026-07-30T13:00:00-07:00")" \
  "iso8601_to_utc_z converts a west-of-UTC offset to the correct UTC instant"
assert_eq "2026-07-30T18:00:00Z" "$(iso8601_to_utc_z "2026-07-30T23:00:00+05:00")" \
  "iso8601_to_utc_z converts an east-of-UTC offset to the correct UTC instant"
assert_eq "2026-07-30T18:00:00Z" "$(iso8601_to_utc_z "2026-07-30T18:00:00Z")" \
  "iso8601_to_utc_z passes an already-Z timestamp through unchanged"

WEST_SHA="$(GIT_COMMITTER_DATE="2026-07-30T13:00:00-07:00" git commit-tree -m t 'HEAD^{tree}')"
assert_eq "2026-07-30T20:00:00Z" "$(git_commit_iso_utc "$WEST_SHA")" \
  "git_commit_iso_utc normalizes a west-of-UTC committer date to Z"

# The bug this replaces: comparing ISO strings LEXICOGRAPHICALLY. A review at
# 18:00 UTC is genuinely BEFORE a 20:00 UTC push, but "18:00:00Z" sorts
# GREATER than "13:00:00-07:00" byte-for-byte (the hour digit alone decides
# it), so the old `$r.submitted_at > $since` read the earlier review as
# having happened after the push.
REVIEWS_TZ="$(jq -n '[
  {user:{login:"coderabbitai[bot]"}, submitted_at:"2026-07-30T18:00:00Z"},
  {user:{login:"copilot-pull-request-reviewer[bot]"}, submitted_at:"2026-07-30T21:00:00Z"}
]')"
RH_TZ="$(reviewed_head_map "$REVIEWS_TZ" "2026-07-30T13:00:00-07:00")"
assert_eq "null" "$(printf '%s' "$RH_TZ" | jq -r '."coderabbitai[bot]" // "null"')" \
  "a review genuinely before the push is not read as caught up"
assert_eq "timestamp" "$(printf '%s' "$RH_TZ" | jq -r '."copilot-pull-request-reviewer[bot]"')" \
  "a review genuinely after the push is read as caught up"

describe "pr-review-watch: iso8601_to_utc_z is portable across the GNU/BSD date split"

# The assertions above this block exercise whatever `date` dialect is NATIVE
# to the host running the suite — BSD on a macOS dev machine, but GNU on the
# Ubuntu runner CI actually uses. A fix that only works on the dialect the
# author happened to test on can still pass the suite 100% of the time on
# their machine while failing outright in CI (the original bug: `date -j -f`
# is BSD-only, GNU date rejects `-j`, and the empty fallback silently made
# `reviewed_head_map` compare every review against the 1970 epoch — a false
# "caught up"). Shim a real GNU `date` onto PATH (Homebrew's `gdate`, if
# present) so BOTH dialects' actual output gets exercised on every host,
# rather than trusting whichever one happens to be native here.
GNU_DATE_BIN="$(command -v gdate || true)"
if [[ -n "$GNU_DATE_BIN" ]]; then
  GNU_SHIM_DIR="$(mktemp -d)"
  ln -s "$GNU_DATE_BIN" "$GNU_SHIM_DIR/date"

  assert_eq "2026-07-30T20:00:00Z" \
    "$(PATH="$GNU_SHIM_DIR:$PATH" iso8601_to_utc_z "2026-07-30T13:00:00-07:00")" \
    "iso8601_to_utc_z converts a west-of-UTC offset under a GNU-dialect date"
  assert_eq "2026-07-30T18:00:00Z" \
    "$(PATH="$GNU_SHIM_DIR:$PATH" iso8601_to_utc_z "2026-07-30T23:00:00+05:00")" \
    "iso8601_to_utc_z converts an east-of-UTC offset under a GNU-dialect date"
  assert_eq "2026-07-30T18:00:00Z" \
    "$(PATH="$GNU_SHIM_DIR:$PATH" iso8601_to_utc_z "2026-07-30T18:00:00Z")" \
    "iso8601_to_utc_z passes an already-Z timestamp through unchanged under GNU date"
  assert_eq "" \
    "$(PATH="$GNU_SHIM_DIR:$PATH" iso8601_to_utc_z "")" \
    "iso8601_to_utc_z still returns empty for empty input under GNU date"

  rm -rf "$GNU_SHIM_DIR"
else
  # No GNU coreutils to shim with (`brew install coreutils` provides gdate)
  # — say so loudly rather than silently passing without exercising this
  # half of the claim at all.
  printf '  \033[33m⚠\033[0m skipped: no gdate on PATH — GNU date dialect not exercised locally\n'
fi

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

# The unresolved fixture's four threads each carry a human ("DonKoko") reply
# after the bot's original comment. shape_findings surfacing that reply as
# its OWN (kind: human) finding must reach poll_once's event stream as
# HUMAN_COMMENT — this is the end-to-end pin for the fix: a human answering
# inside a bot-created thread must be visibly surfaced, not silently folded
# into the bot's original (already-fingerprinted-differently) finding.
assert_eq "1" "$(printf '%s\n' "$POLL1" | grep -c '"event":"HUMAN_COMMENT"')" \
  "a human reply inside a bot-created thread is announced as HUMAN_COMMENT"
assert_eq "0" "$(printf '%s\n' "$POLL2" | grep -c '"event":"HUMAN_COMMENT"')" \
  "the same human reply is not re-announced on a later poll"
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

# CHECKS_CLEAR (C2) — the counterpart notification for when checks stop
# being red. On the dominant path (push -> CI pending -> ... -> green) this
# is one of the only two events (with QUIESCENT) the watcher emits again, so
# a regression here means the loop goes silent right when checks resolve.
collect_checks() { printf '{"red":0,"pending":0}'; }
CLEAR1="$(poll_once 5003)"
CLEAR2="$(poll_once 5003)"
assert_eq "1" "$(printf '%s\n' "$CLEAR1" | grep -c '"event":"CHECKS_CLEAR"')" \
  "CHECKS_CLEAR is announced when checks stop being red"
assert_eq "0" "$(printf '%s\n' "$CLEAR2" | grep -c '"event":"CHECKS_CLEAR"')" \
  "CHECKS_CLEAR is not repeated while checks stay green"

# A PR polled for the first time with already-clean checks must not
# spuriously announce CHECKS_CLEAR — there was no red state to clear FROM.
state_init 5009 "test-branch"
NEVERRED="$(poll_once 5009)"
assert_eq "0" "$(printf '%s\n' "$NEVERRED" | grep -c '"event":"CHECKS_CLEAR"')" \
  "CHECKS_CLEAR does not fire for a PR that was never observed red"
collect_checks() { printf '{"red":2,"pending":1}'; }

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

# reviewedHead is what quiescence condition #1 is computed from. It was
# defined and unit-tested but never populated by poll_once, leaving it {}
# forever — the loop could never tell whether the bots had caught up.
state_init 5006 "test-branch"
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
poll_once 5006 >/dev/null
assert_eq "a3293f170e" "$(state_read 5006 | jq -r '.reviewedHead["chatgpt-codex-connector[bot]"]')" \
  "poll_once populates reviewedHead from the codex Reviewed-commit marker"
assert_eq "false" "$(state_read 5006 | jq -r '.reviewedHead == {}')" \
  "reviewedHead is no longer permanently empty"

# A decided finding re-posted under a NEW thread id must tick the counter that
# the three-repost escape hatch reads. Same thread across polls must NOT.
state_init 5007 "test-branch"
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/unresolved"
poll_once 5007 >/dev/null
FP="$(state_read 5007 | jq -r '.pending[0].fingerprint')"
TID="$(state_read 5007 | jq -r '.pending[0].threadId')"

# Mark it decided in the skill's OWN file, recording the thread it was
# decided on — decisions_write is a test-only seam simulating the skill.
jq -n --arg fp "$FP" --arg tid "$TID" \
  '{seen: {($fp): {threadId:$tid, verdict:"FALSE_POSITIVE", decidedInRound:1}}}' \
  | decisions_write 5007

SAME_THREAD="$(poll_once 5007)"   # same thread still present
assert_eq "0" "$(repost_count "$FP" "$(state_read 5007)")" \
  "a decided finding on the SAME thread does not tick the repost counter"
assert_eq "0" "$(printf '%s\n' "$SAME_THREAD" | grep -c '"event":"REPOST"')" \
  "a decided finding on the SAME thread does not emit REPOST either (C1)"

# Simulate the bot closing that thread and re-posting the identical finding
# under a new id — the exact case fingerprinting exists to catch, and the
# case C1 exists for: unseen_findings drops this from `.pending` by
# fingerprint alone, so without REPOST this thread would never be answered.
decisions_read 5007 | jq --arg fp "$FP" '.seen[$fp].threadId = "PRRT_previously_closed"' \
  | decisions_write 5007
REPOSTED="$(poll_once 5007)"
assert_eq "1" "$(repost_count "$FP" "$(state_read 5007)")" \
  "a decided finding re-posted under a new thread id ticks the repost counter"
assert_eq "1" "$(printf '%s\n' "$REPOSTED" | grep -c '"event":"REPOST"')" \
  "the same re-post emits REPOST exactly once (C1)"
assert_eq "1" "$(state_read 5007 | jq '.reposted | length')" \
  "state.reposted carries the currently-open re-post for the skill to read"

# Not re-announced while the mismatch persists unchanged across polls.
REPOSTED2="$(poll_once 5007)"
assert_eq "0" "$(printf '%s\n' "$REPOSTED2" | grep -c '"event":"REPOST"')" \
  "REPOST is not re-emitted while the same re-post persists"

# The skill answers it (records a fresh decision on the new thread) — REPOST
# must clear and, on the NEXT distinct mismatch, fire again rather than
# staying silent forever.
decisions_read 5007 | jq --arg fp "$FP" '.seen[$fp].threadId = "PRRT_previously_closed_2"' \
  | decisions_write 5007
REPOSTED3="$(poll_once 5007)"
assert_eq "1" "$(printf '%s\n' "$REPOSTED3" | grep -c '"event":"REPOST"')" \
  "a distinct re-post (different priorThreadId) fires REPOST again"

# Top-level PR comments. Review threads carry only INLINE comments, so without
# this a teammate writing in the conversation box is never surfaced at all —
# and React Doctor's findings, which arrive as a sticky bot comment, never
# reach the loop either.
state_init 5008 "test-branch"
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
DOC1="$(poll_once 5008)"
DOC2="$(poll_once 5008)"

assert_eq "1" "$(printf '%s\n' "$DOC1" | grep -c '"event":"DOCTOR"')" \
  "React Doctor's sticky comment is announced on the first poll"
assert_eq "0" "$(printf '%s\n' "$DOC2" | grep -c '"event":"DOCTOR"')" \
  "React Doctor is not re-announced while its comment is unchanged"
assert_eq "1" "$(state_read 5008 | jq '.doctor | length')" \
  "the doctor comment is persisted to state for the skill to read"
assert_eq "0" "$(state_read 5008 | jq '.humanComments | length')" \
  "the pr2770 fixture has no human top-level comments"

# A REWRITTEN sticky comment must re-announce: React Doctor edits in place,
# and newly-introduced errors are the only part of its output that fails a PR.
# Id-only dedup would silence exactly that.
state_read 5008 | jq '.announcedComments = {}' | state_write 5008
DOC3="$(poll_once 5008)"
assert_eq "1" "$(printf '%s\n' "$DOC3" | grep -c '"event":"DOCTOR"')" \
  "a rewritten doctor comment is announced again"

export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"

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

assert_eq "0" "$(decisions_read 5005 | jq '.seen // {} | length')" \
  "the vanish/return cycle never wrote a verdict — these are still unjudged"

describe "pr-review-watch: QUIESCENT integration (C2)"

# A synthetic "everything caught up" scenario built on the fully-resolved
# pr2770 fixture (0 pending bot findings): its 3 out-of-diff reviews are
# marked addressed in decisions, checks are forced clean, and head_sha is
# overridden to a value codex's own "Reviewed commit" marker
# ("a3293f170e") is a genuine prefix of — the real pr2770 fixture's
# headRefOid predates that marker and would never satisfy condition #1.
#
# Each override below runs INSIDE a `$( ... )` subshell — matching the
# WITHHELD seam earlier in this file — rather than redefining the function
# in this shell and later `unset -f`-ing it. Bash has no way to "restore"
# a function once a redefinition has shadowed the one this file sourced
# from pr-review-watch.sh; `unset -f` removes it outright, permanently
# breaking every LATER poll_once call that needs the real implementation.
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
state_init 5016 "test-branch"
jq -n '{addressedOutOfDiff: {"4816835588":true,"4817446544":true,"4818550423":true}}' \
  | decisions_write 5016

Q1="$(
  head_sha() { printf 'a3293f170e0000000000000000000000000000'; }
  collect_checks() { printf '{"red":0,"pending":0}'; }
  poll_once 5016
)"
assert_eq "1" "$(printf '%s\n' "$Q1" | grep -c '"event":"QUIESCENT"')" \
  "QUIESCENT fires once every condition is satisfied"
assert_eq "true" "$(state_read 5016 | jq -r '.quiescent')" \
  "state.quiescent is persisted true"

Q2="$(
  head_sha() { printf 'a3293f170e0000000000000000000000000000'; }
  collect_checks() { printf '{"red":0,"pending":0}'; }
  poll_once 5016
)"
assert_eq "0" "$(printf '%s\n' "$Q2" | grep -c '"event":"QUIESCENT"')" \
  "QUIESCENT does not repeat while the PR stays clean"

# New activity — an out-of-diff finding becomes unaddressed again — must
# leave the quiescent state, and returning to clean must re-announce.
decisions_read 5016 | jq '.addressedOutOfDiff = {}' | decisions_write 5016
Q3="$(
  head_sha() { printf 'a3293f170e0000000000000000000000000000'; }
  collect_checks() { printf '{"red":0,"pending":0}'; }
  poll_once 5016
)"
assert_eq "0" "$(printf '%s\n' "$Q3" | grep -c '"event":"QUIESCENT"')" \
  "un-addressing an out-of-diff finding does not itself re-announce QUIESCENT"
assert_eq "false" "$(state_read 5016 | jq -r '.quiescent')" \
  "state.quiescent reflects the regression out of the clean state"

decisions_read 5016 \
  | jq '.addressedOutOfDiff = {"4816835588":true,"4817446544":true,"4818550423":true}' \
  | decisions_write 5016
Q4="$(
  head_sha() { printf 'a3293f170e0000000000000000000000000000'; }
  collect_checks() { printf '{"red":0,"pending":0}'; }
  poll_once 5016
)"
assert_eq "1" "$(printf '%s\n' "$Q4" | grep -c '"event":"QUIESCENT"')" \
  "QUIESCENT re-announces on the next transition back to clean"

describe "pr-review-watch: degraded collection preserves prior payload (I2)"

export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
state_init 5017 "test-branch"
poll_once 5017 >/dev/null   # good poll (real functions): populates .doctor
DOCTOR_BEFORE="$(state_read 5017 | jq -c '.doctor')"
assert_eq "1" "$(printf '%s' "$DOCTOR_BEFORE" | jq 'length')" \
  "doctor payload is populated before the simulated failure"

DEGRADED_ISSUES="$(
  collect_issue_comments() { return 1; }
  poll_once 5017
)"
assert_eq "$DOCTOR_BEFORE" "$(state_read 5017 | jq -c '.doctor')" \
  "a failed collect_issue_comments keeps .doctor at its prior value, not []"
assert_eq "1" "$(printf '%s\n' "$DEGRADED_ISSUES" | grep -c '"event":"ERROR"')" \
  "a failed collect_issue_comments reports an ERROR event"
assert_eq "0" "$(printf '%s\n' "$DEGRADED_ISSUES" | grep -c '"event":"DOCTOR"')" \
  "the preserved (unchanged) doctor payload is not spuriously re-announced"

state_init 5018 "test-branch"
poll_once 5018 >/dev/null   # good poll (real functions): populates .outOfDiff
OOD_BEFORE="$(state_read 5018 | jq -c '.outOfDiff')"
assert_eq "3" "$(printf '%s' "$OOD_BEFORE" | jq 'length')" \
  "out-of-diff payload is populated before the simulated failure"

DEGRADED_REVIEWS="$(
  collect_reviews() { return 1; }
  poll_once 5018
)"
assert_eq "$OOD_BEFORE" "$(state_read 5018 | jq -c '.outOfDiff')" \
  "a failed collect_reviews keeps .outOfDiff at its prior value, not []"
assert_eq "1" "$(printf '%s\n' "$DEGRADED_REVIEWS" | grep -c '"event":"ERROR"')" \
  "a failed collect_reviews reports an ERROR event"

describe "pr-review-watch: checks fallback is never green-by-default (I2)"

state_init 5019 "test-branch"
(
  collect_checks() { return 1; }
  poll_once 5019
) >/dev/null
assert_eq "1" "$(state_read 5019 | jq -r '.checks.pending')" \
  "a failed collect_checks falls back to pending:1, never green-by-default"
assert_eq "0" "$(state_read 5019 | jq -r '.checks.red')" \
  "the failure fallback still reports red:0 — not a false red either"
assert_eq "false" "$(state_read 5019 | jq -r '.quiescent')" \
  "a degraded checks collection cannot read as quiescent"

# A persistent fault must report once, not once per poll.
LAST_ERROR=""
emit_error_once "boom" >/dev/null
assert_eq "0" "$(emit_error_once "boom" | wc -c | tr -d ' ')" \
  "a repeated identical error is not re-emitted"
assert_eq "1" "$(emit_error_once "different" | wc -l | tr -d ' ')" \
  "a distinct error is still reported"
LAST_ERROR=""

# ============================================================================
# Round A2 hardening — items 1-5 from the follow-up review. Each of these
# five is a SILENT failure mode: the watcher is a background monitor whose
# stdout is a chat notification stream, so a hang or a missed transition
# emits nothing and is indistinguishable from a quiet, healthy PR.
#
# Every override below is scoped inside its own `$( … )` subshell, matching
# the WITHHELD pattern above — never a bare top-level redefinition followed
# by `unset -f`, which cannot "restore" a shadowed function (it deletes it
# outright, breaking every LATER call that needs the real implementation).
# ============================================================================

describe "pr-review-watch: collect_threads pagination guard (item 1)"

# A misbehaving API returning hasNextPage:true with a repeating cursor must
# not spin collect_threads — and so the whole poll loop — forever. Every
# call returns exactly one thread and claims another page always follows.
gql_threads_page_infinite() {
  jq -n '{
    data: { repository: { pullRequest: { headRefOid: "deadbeef",
      reviewThreads: {
        pageInfo: { hasNextPage: true, endCursor: "same-cursor-always" },
        nodes: [ { id: "PRRT_infinite", isResolved: false, isOutdated: false,
                   path: "a.ts", line: 1,
                   comments: { nodes: [ { id: "c1", databaseId: 1,
                     author: { login: "chatgpt-codex-connector" },
                     body: "x", createdAt: "2026-01-01T00:00:00Z" } ] } } ]
      } } } }
  }'
}

# Wrapped in run_with_timeout (item 2's own primitive) so a REGRESSION of
# the page cap fails this test loudly (exit 124) instead of hanging the
# whole suite.
PAGINATION_JSON="$(
  COLLECT_THREADS_MAX_PAGES=3
  gql_threads_page() { gql_threads_page_infinite; }
  run_with_timeout 5 collect_threads 9001
)"
PAGINATION_RC=$?

assert_eq "2" "$PAGINATION_RC" \
  "collect_threads returns exit code 2 (not 0, not 124/timeout) when the page cap fires"
assert_json_eq "3" "$PAGINATION_JSON" 'length' \
  "collect_threads returns exactly the 3 pages collected before giving up — proves it stopped AT the cap"

# poll_once integration: the truncation must not be silently swallowed
# (an ERROR is emitted) NOR discard the partial data it already has (the
# findings collected before the cap still get processed as NEW_FINDINGS).
POLL_PAGINATION="$(
  COLLECT_THREADS_MAX_PAGES=2
  gql_threads_page() { gql_threads_page_infinite; }
  detect_push() { printf ''; }
  export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
  state_init 5020 "test-branch"
  run_with_timeout 5 poll_once 5020
)"
assert_eq "1" "$(printf '%s\n' "$POLL_PAGINATION" | grep -c '"event":"ERROR"')" \
  "poll_once emits exactly one ERROR event when the pagination cap fires"
assert_contains "$POLL_PAGINATION" "pagination limit" \
  "the ERROR event names the pagination limit, not a generic/unexplained failure"
assert_eq "1" "$(printf '%s\n' "$POLL_PAGINATION" | grep -c '"event":"NEW_FINDINGS"')" \
  "poll_once still processes the partial findings collected before the cap, not just errors out"

describe "pr-review-watch: CHECKS_RED keyed on .red alone (item 4)"

# `.pending` legitimately counts down (5->4->3->0) while ONE check stays
# red throughout an ordinary CI run. Comparing the whole {red,pending}
# tuple (the pre-fix behavior) read every pending decrement as a fresh
# transition — measured at 4 identical CHECKS_RED notifications for one
# unchanged failure. Scoped to its own subshell/PR id so it can't leak a
# collect_checks override into any other test.
PENDING_CHURN="$(
  detect_push() { printf ''; }
  export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
  state_init 5021 "test-branch"
  collect_checks() { printf '{"red":1,"pending":5}'; }
  R1="$(poll_once 5021)"
  collect_checks() { printf '{"red":1,"pending":4}'; }
  R2="$(poll_once 5021)"
  collect_checks() { printf '{"red":1,"pending":3}'; }
  R3="$(poll_once 5021)"
  collect_checks() { printf '{"red":1,"pending":0}'; }
  R4="$(poll_once 5021)"
  printf 'R1=%s\nR2=%s\nR3=%s\nR4=%s\n' \
    "$(printf '%s\n' "$R1" | grep -c '"event":"CHECKS_RED"')" \
    "$(printf '%s\n' "$R2" | grep -c '"event":"CHECKS_RED"')" \
    "$(printf '%s\n' "$R3" | grep -c '"event":"CHECKS_RED"')" \
    "$(printf '%s\n' "$R4" | grep -c '"event":"CHECKS_RED"')"
)"

assert_eq "1" "$(printf '%s\n' "$PENDING_CHURN" | grep '^R1=' | cut -d= -f2)" \
  "CHECKS_RED fires on the first red observation"
assert_eq "0" "$(printf '%s\n' "$PENDING_CHURN" | grep '^R2=' | cut -d= -f2)" \
  "CHECKS_RED does not re-fire when only .pending changes (5->4), same red check"
assert_eq "0" "$(printf '%s\n' "$PENDING_CHURN" | grep '^R3=' | cut -d= -f2)" \
  "CHECKS_RED does not re-fire when only .pending changes (4->3)"
assert_eq "0" "$(printf '%s\n' "$PENDING_CHURN" | grep '^R4=' | cut -d= -f2)" \
  "CHECKS_RED does not re-fire as .pending drains to 0 with the same red check (the exact bug: 4 notifications for 1 failure)"

describe "pr-review-watch: state_refresh_branch (item 5)"

state_init 5022 "old-branch"
assert_eq "old-branch" "$(state_read 5022 | jq -r '.branch')" \
  "sanity: state_init seeds .branch on first creation"

# state_init alone must NOT fix a stale .branch on a resumed state file — it
# deliberately never clobbers an existing file (so `seen`/pending history
# survives a resume). This simulates the bug exactly: a state file left
# over from watching PR 5022 on a DIFFERENT branch keeps the old name.
state_read 5022 | jq '.round = 5' | state_write 5022
state_init 5022 "new-branch"
assert_eq "old-branch" "$(state_read 5022 | jq -r '.branch')" \
  "state_init alone leaves a stale .branch on a resumed state file (confirms the bug this closes)"

state_refresh_branch 5022 "new-branch"
assert_eq "new-branch" "$(state_read 5022 | jq -r '.branch')" \
  "state_refresh_branch corrects the stale .branch"
assert_eq "5" "$(state_read 5022 | jq -r '.round')" \
  "state_refresh_branch does not disturb unrelated fields (round preserved)"

describe "pr-review-watch: validate_head_sha (item 3 — unit level)"

validate_head_sha "15a4e0a58707a8db432eba9ac4e3b5e31d136b7c"
assert_eq "0" "$?" "a real 40-char lowercase-hex SHA is accepted"

validate_head_sha "null"
assert_eq "1" "$?" \
  "the literal string \"null\" (GitHub's null pullRequest, HTTP 200, gh exit 0) is rejected"

validate_head_sha ""
assert_eq "1" "$?" "an empty SHA is rejected"

validate_head_sha "15A4E0A58707A8DB432EBA9AC4E3B5E31D136B7C"
assert_eq "1" "$?" "an uppercase-hex SHA (git/GitHub never emit one) is rejected defensively"

validate_head_sha "15a4e0a58707a8db432eba9ac4e3b5e31d136b7"
assert_eq "1" "$?" "a 39-char (truncated) SHA is rejected"

describe "pr-review-watch: main exits loudly on a bad PR number (item 3 — integration)"

# Before this fix: repository.pullRequest comes back null (HTTP 200, gh exit
# 0) for a bad PR number, head_sha's `-r` renders the literal string "null",
# and the loop below would poll a PR that can never produce anything —
# emitting NOTHING, forever, indistinguishable from a quiet healthy PR.
BAD_PR_OUT="$(
  {
    head_sha() { printf 'null'; }
    main 999999
  } 2>&1
)"
BAD_PR_RC=$?

assert_eq "2" "$BAD_PR_RC" \
  "main exits 2 (not 0, not hanging in the poll loop) for an unresolvable head SHA"
assert_contains "$BAD_PR_OUT" "PR #999999" \
  "the exit message names the offending PR number"
assert_contains "$BAD_PR_OUT" "head SHA" \
  "the exit message explains the actual problem instead of failing silently"

describe "pr-review-watch: run_with_timeout (item 2 — the primitive detect_push relies on)"

# git fetch itself is exercised only manually (a real network hang is
# impractical to simulate deterministically in a unit test — see
# task-5-report.md for that transcript). This covers the actual timeout
# PRIMITIVE, using `sleep` as a stand-in for a hung subprocess.
T0=$(date +%s)
run_with_timeout 1 sleep 30
TIMEOUT_RC=$?
T1=$(date +%s)
ELAPSED=$((T1 - T0))

assert_eq "124" "$TIMEOUT_RC" \
  "run_with_timeout returns 124 (matching GNU timeout) when the command hangs past the deadline"
if [[ "$ELAPSED" -le 10 ]]; then TIMELY="yes"; else TIMELY="no"; fi
assert_eq "yes" "$TIMELY" \
  "run_with_timeout actually returns quickly (<=10s) rather than waiting out the full 30s hang"

run_with_timeout 5 true
assert_eq "0" "$?" "run_with_timeout returns the real exit status on the non-timeout path"

run_with_timeout 5 bash -c 'exit 7'
assert_eq "7" "$?" "run_with_timeout preserves a non-zero-but-not-a-timeout exit status"

# A plain single-PID kill only reaches the direct child — any subprocess IT
# forked (git spawns a transport helper for the actual network I/O) survives
# as an orphan. `bash -c "sleep 40"` mirrors that shape: run_with_timeout's
# direct child is the wrapper `bash`, and `sleep` is ITS child, one level
# down — exactly what a single `kill "$pid"` would miss.
run_with_timeout 1 bash -c "sleep 40"
sleep 0.5
assert_eq "0" "$(pgrep -f 'sleep 40' | wc -l | tr -d ' ')" \
  "run_with_timeout kills the whole process tree, not just the direct child (no orphaned grandchild)"

describe "pr-review-watch: LAST_ERROR does not re-arm on a degraded-but-continuing poll"

# Before this fix: collect_reviews failing did NOT `return 1` (it's a
# degraded-but-continuing path — poll_once keeps going with the prior
# .outOfDiff payload), so poll_once still reached state_write successfully,
# which unconditionally reset LAST_ERROR at the bottom. A PERSISTENTLY
# failing collect_reviews (revoked token scope, repo permission change,
# GitHub incident) then re-announced ERROR on every single poll — one per
# POLL_INTERVAL forever, which is the exact "emits too much, gets
# auto-killed" self-destruct the transition guards throughout this file
# exist to prevent, just reached via the degraded-poll path instead of a
# hard failure. POLL_DEGRADED closes it: emit_error_once sets it whenever
# THIS poll hit a degraded collection, and the bottom-of-poll_once reset is
# skipped while it's set.
#
# LAST_ERROR/POLL_DEGRADED are process-lifetime shell globals by design —
# that's exactly what makes them work in the REAL script, where main()'s
# loop calls poll_once directly, in the same shell process, every
# iteration. `X="$(poll_once ...)"` breaks that on purpose-built test
# harness reasoning alone: command substitution FORKS A SUBSHELL, so a
# global mutation made inside one `$(poll_once ...)` call is invisible to
# the next `$(poll_once ...)` call — verified directly (a toy counter
# incremented across two `$(f)` calls stayed 0 in the caller, but reached 2
# across two plain-redirected `f > file` calls). Every poll_once call below
# therefore redirects to a file instead of being captured via `$(...)`, so
# these globals persist between calls exactly as they do in production.
DEGRADED_TMP="$(mktemp -d)"
(
  detect_push() { printf ''; }
  export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
  state_init 5023 "test-branch"
  collect_reviews() { return 1; }
  poll_once 5023 > "$DEGRADED_TMP/d1"
  poll_once 5023 > "$DEGRADED_TMP/d2"
  poll_once 5023 > "$DEGRADED_TMP/d3"
)

assert_eq "1" "$(grep -c '"event":"ERROR"' "$DEGRADED_TMP/d1")" \
  "the first poll with a persistently-failing collect_reviews emits ERROR"
assert_eq "0" "$(grep -c '"event":"ERROR"' "$DEGRADED_TMP/d2")" \
  "the SAME persistent failure does not re-announce on the second consecutive poll"
assert_eq "0" "$(grep -c '"event":"ERROR"' "$DEGRADED_TMP/d3")" \
  "...nor the third — this is the bug closed: 3 consecutive degraded polls used to emit 3 ERRORs, now 1"
rm -rf "$DEGRADED_TMP"

# The mirror-image requirement: an intervening CLEAN poll must still
# re-arm LAST_ERROR, so a fault that recurs later (a distinct incident, not
# the same ongoing one) is newsworthy again. Restoring collect_reviews to
# its real body for the middle poll — never `unset -f` (see the note above
# the "Round A2 hardening" section: it cannot restore a shadowed function,
# it just deletes it, breaking any LATER call that needs the original).
REARM_TMP="$(mktemp -d)"
(
  detect_push() { printf ''; }
  export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"
  state_init 5024 "test-branch"

  collect_reviews() { return 1; }
  poll_once 5024 > "$REARM_TMP/f1"

  collect_reviews() { gh api "repos/$REPO/pulls/$1/reviews"; }   # real body
  poll_once 5024 > "$REARM_TMP/clean"

  collect_reviews() { return 1; }
  poll_once 5024 > "$REARM_TMP/f2"
)

assert_eq "1" "$(grep -c '"event":"ERROR"' "$REARM_TMP/f1")" \
  "the first fault emits ERROR"
assert_eq "0" "$(grep -c '"event":"ERROR"' "$REARM_TMP/clean")" \
  "an intervening genuinely-clean poll emits nothing"
assert_eq "1" "$(grep -c '"event":"ERROR"' "$REARM_TMP/f2")" \
  "the fault recurring AFTER a clean poll re-announces — re-armed, not stuck suppressed forever (2 ERRORs total across this sequence, not 1)"
rm -rf "$REARM_TMP"

unset -f detect_push collect_checks
export GH_FIXTURE_DIR="$ROOT/scripts/__tests__/fixtures/pr2770"

describe "pr-review-watch: push seeding (main's lastPushedAt bug)"

# Fake an already-pushed remote via the resolve_remote_ref seam — matches the
# detect_push/collect_checks pattern, and avoids touching real
# remote-tracking refs in this repo.
SEED_SHA="$(GIT_COMMITTER_DATE="2026-07-30T13:00:00-07:00" git commit-tree -m seed 'HEAD^{tree}')"
resolve_remote_ref() { printf '%s' "$SEED_SHA"; }

state_init 6001 "test-branch"
seed_push_state 6001 "test-branch"

assert_eq "$SEED_SHA" "$(state_read 6001 | jq -r '.lastPushedSha')" \
  "seed_push_state records the already-pushed remote SHA"
assert_eq "2026-07-30T20:00:00Z" "$(state_read 6001 | jq -r '.lastPushedAt')" \
  "seed_push_state UTC-normalizes lastPushedAt from a west-of-UTC committer offset"

# The consequence this seeding exists to prevent: without a seeded
# lastPushedAt, $since falls back to the 1970 epoch and EVERY bot review
# reads as after the push — a false clean by default, not an edge case. With
# it, a review before the actual push is correctly NOT caught up.
EARLY="$(jq -n '[{user:{login:"coderabbitai[bot]"}, submitted_at:"2026-07-30T19:00:00Z"}]')"
RH_SEED="$(reviewed_head_map "$EARLY" "$(state_read 6001 | jq -r '.lastPushedAt')")"
assert_eq "null" "$(printf '%s' "$RH_SEED" | jq -r '."coderabbitai[bot]" // "null"')" \
  "a review before the seeded push time correctly reads as not caught up"

# Idempotent — does not reseed once lastPushedSha is already set.
resolve_remote_ref() { printf '%s' "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"; }
seed_push_state 6001 "test-branch"
assert_eq "$SEED_SHA" "$(state_read 6001 | jq -r '.lastPushedSha')" \
  "seed_push_state does not reseed once lastPushedSha is already set"

# Not-yet-pushed branch: resolve_remote_ref returns empty, nothing is seeded.
resolve_remote_ref() { printf ''; }
state_init 6002 "unpushed-branch"
seed_push_state 6002 "unpushed-branch"
assert_eq "null" "$(state_read 6002 | jq -r '.lastPushedSha')" \
  "seed_push_state leaves lastPushedSha null when the branch has no remote ref yet"

unset -f resolve_remote_ref
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

# The skill owns a SAME-DIRECTORY object-shaped ledger (`<pr>.decisions.json`,
# `{seen:{...}, escalated:[...]}`). Passing it here by mistake must fail
# loudly, not silently read `jq 'length'` as a key count and mangle every
# reply against a malformed index.
cat > "$TMP_D/object.json" <<'JSON'
{"seen":{},"escalated":[],"addressedOutOfDiff":{}}
JSON
OBJ_RC=0
bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$TMP_D/object.json" --dry-run \
  >/dev/null 2>&1 || OBJ_RC=$?
assert_eq "2" "$OBJ_RC" \
  "an object-shaped decisions file (the skill's own ledger) is rejected"

# A missing replyBody must never reach `gh` at all — not even as the literal
# string "null", which `jq -r` would otherwise print for a null/absent field.
: > "$GH_MUTATION_LOG"
cat > "$TMP_D/missing-body.json" <<'JSON'
[{"threadId":"PRRT_missing","resolve":true}]
JSON
MISSING_RC=0
bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$TMP_D/missing-body.json" \
  >/dev/null 2>&1 || MISSING_RC=$?
assert_eq "1" "$MISSING_RC" \
  "a decision with a missing replyBody makes the script exit non-zero"
assert_eq "0" "$(grep -c 'addPullRequestReviewThreadReply' "$GH_MUTATION_LOG")" \
  "a missing replyBody is never posted — not even the literal string null"
assert_eq "0" "$(grep -c 'resolveReviewThread' "$GH_MUTATION_LOG")" \
  "a decision with a missing replyBody is not resolved either"

# A resolve that fails AFTER a successful reply must still be counted, so the
# script's exit status means "everything landed" — not just "every reply
# posted". The reply itself must still have gone out; only resolve failed.
: > "$GH_MUTATION_LOG"
RESOLVEFAILDIR="$TMP_D/resolvefailbin"; mkdir -p "$RESOLVEFAILDIR"
cat > "$RESOLVEFAILDIR/gh" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
args="$*"
[[ -n "${GH_MUTATION_LOG:-}" ]] && printf '%s\n' "$args" >> "$GH_MUTATION_LOG"
case "$args" in
  *resolveReviewThread*) exit 1 ;;   # simulate a failed resolve
  *) printf '{"data":{"ok":true}}\n' ;;
esac
STUB
chmod +x "$RESOLVEFAILDIR/gh"
cat > "$TMP_D/resolve-fail.json" <<'JSON'
[{"threadId":"PRRT_yyy","replyBody":"Fixed in deadbee — tightened the guard.","resolve":true}]
JSON
RESOLVE_FAIL_RC=0
PATH="$RESOLVEFAILDIR:$PATH" bash "$ROOT/scripts/pr-review-respond.sh" 2770 \
  "$TMP_D/resolve-fail.json" >/dev/null 2>&1 || RESOLVE_FAIL_RC=$?

assert_eq "1" "$RESOLVE_FAIL_RC" \
  "a failed resolve_mutation makes the script's exit status non-zero"
assert_eq "1" "$(grep -c 'addPullRequestReviewThreadReply' "$GH_MUTATION_LOG")" \
  "the reply itself still posted despite the resolve failing"

# A decision with a missing/null threadId must never reach `gh` either — not
# even as the literal string "null", which would post to a non-existent
# thread and obscure the real (data) problem behind a generic API error.
: > "$GH_MUTATION_LOG"
cat > "$TMP_D/missing-thread.json" <<'JSON'
[{"replyBody":"Fixed in deadbee — tightened the guard.","resolve":true}]
JSON
MISSING_THREAD_RC=0
bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$TMP_D/missing-thread.json" \
  >/dev/null 2>&1 || MISSING_THREAD_RC=$?
assert_eq "1" "$MISSING_THREAD_RC" \
  "a decision with a missing threadId makes the script exit non-zero"
assert_eq "0" "$(grep -c 'addPullRequestReviewThreadReply' "$GH_MUTATION_LOG")" \
  "a missing threadId is never posted to — not even the literal string null"

describe "pr-review-respond: ledger fail-fast on a read-only git dir"

# A read-only .git (or computed git common dir) must abort BEFORE any live
# mutation, not silently continue with a ledger that can never record a
# successful reply — that would turn every future re-run into a
# duplicate-post risk with no error anywhere pointing at the cause.
RO_TMP="$(mktemp -d)"
RO_GIT="$RO_TMP/git"
mkdir -p "$RO_GIT/pr-review-loop"
chmod 555 "$RO_GIT/pr-review-loop"
cat > "$RO_TMP/decisions.json" <<'JSON'
[{"threadId":"PRRT_ro","replyBody":"Fixed in deadbee.","resolve":true}]
JSON
RO_LOG="$RO_TMP/mutations.log"; : > "$RO_LOG"
RO_RC=0
GIT_COMMON_DIR="$RO_GIT" GH_MUTATION_LOG="$RO_LOG" \
  bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$RO_TMP/decisions.json" \
  >/dev/null 2>&1 || RO_RC=$?
assert_eq "1" "$RO_RC" \
  "a read-only ledger directory makes the script exit non-zero, before any mutation"
assert_eq "0" "$(grep -c 'addPullRequestReviewThreadReply' "$RO_LOG")" \
  "no reply is ever attempted when the ledger cannot be written"
chmod 755 "$RO_GIT/pr-review-loop"
rm -rf "$RO_TMP"

describe "pr-review-respond: a failed ledger write after a successful reply is a failed run"

# The reply itself already went out (outward-facing, cannot be un-posted);
# only the ledger write failed. This must NOT read as a clean run — silently
# proceeding as if replied=1 masks that the ledger can no longer prove the
# reply happened — and, per the resolve invariant above, must also not
# resolve the thread.
LW_TMP="$(mktemp -d)"
LW_GIT="$LW_TMP/git"
mkdir -p "$LW_GIT/pr-review-loop"
# Pre-create the ledger file read-only. touch(1) on an EXISTING file can
# still succeed for the owner even when it isn't writable (verified: macOS
# touch updates mtime via utimes, not a write-open) — so the fail-fast guard
# above does not trip here — but actually appending a line to it fails,
# which is exactly the scenario record()'s exit status now has to catch.
touch "$LW_GIT/pr-review-loop/2770.replies"
chmod 444 "$LW_GIT/pr-review-loop/2770.replies"
cat > "$LW_TMP/decisions.json" <<'JSON'
[{"threadId":"PRRT_lw","replyBody":"Fixed in deadbee.","resolve":true}]
JSON
LW_LOG="$LW_TMP/mutations.log"; : > "$LW_LOG"
LW_RC=0
GIT_COMMON_DIR="$LW_GIT" GH_MUTATION_LOG="$LW_LOG" \
  bash "$ROOT/scripts/pr-review-respond.sh" 2770 "$LW_TMP/decisions.json" \
  >/dev/null 2>&1 || LW_RC=$?
assert_eq "1" "$LW_RC" \
  "a reply that posts but can't be recorded makes the script exit non-zero"
assert_eq "1" "$(grep -c 'addPullRequestReviewThreadReply' "$LW_LOG")" \
  "the reply mutation itself still went out — that part cannot be undone"
assert_eq "0" "$(grep -c 'resolveReviewThread' "$LW_LOG")" \
  "the thread is NOT resolved when the ledger write failed — the reply isn't durably confirmed"
chmod 644 "$LW_GIT/pr-review-loop/2770.replies"
rm -rf "$LW_TMP"

rm -rf "$TMP_D"
unset GH_MUTATION_LOG GIT_COMMON_DIR

# --- summary ----------------------------------------------------------------
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
