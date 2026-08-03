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

# decisions_read must not error before the skill has ever written anything —
# poll_once depends on a fresh PR reading as "nothing decided yet", not a
# hard failure.
assert_eq "{}" "$(decisions_read 2770)" \
  "decisions_read returns an empty object when no decisions.json exists yet"

FRESH="$(unseen_findings "$FINDINGS" "$(decisions_read 2770)")"
assert_json_eq "4" "$FRESH" 'length' "all four findings are unseen on a fresh decisions doc"

# Record a verdict for the first fingerprint, then re-run. Written to the
# SKILL's own file via decisions_write (a test-only seam) — this script must
# never write decisions.json itself.
FP="$(printf '%s' "$FINDINGS" | jq -r '.[0].fingerprint')"
jq -n --arg fp "$FP" '{seen: {($fp): {verdict:"FALSE_POSITIVE", decidedInRound:1}}}' \
  | decisions_write 2770
FRESH="$(unseen_findings "$FINDINGS" "$(decisions_read 2770)")"
assert_json_eq "3" "$FRESH" 'length' "a decided fingerprint is not re-triaged"

# A VALID (already-fixed) verdict must ALSO suppress re-triage — a bot
# re-flagging fixed work is at least as common as one re-flagging a rejection.
FP2="$(printf '%s' "$FINDINGS" | jq -r '.[1].fingerprint')"
decisions_read 2770 | jq --arg fp "$FP2" \
  '.seen[$fp] = {verdict:"VALID", decidedInRound:1, resolvedSha:"abc1234"}' \
  | decisions_write 2770
FRESH="$(unseen_findings "$FINDINGS" "$(decisions_read 2770)")"
assert_json_eq "2" "$FRESH" 'length' "an already-fixed fingerprint is not re-triaged"

# ESCALATE verdicts live in .escalated[], not .seen — and must ALSO suppress
# re-triage, or the loop re-dispatches a triager for the same finding every
# round.
FP3="$(printf '%s' "$FINDINGS" | jq -r '.[2].fingerprint')"
decisions_read 2770 | jq --arg fp "$FP3" \
  '.escalated += [{fingerprint:$fp, reason:"security-flavored", round:1}]' \
  | decisions_write 2770
FRESH="$(unseen_findings "$FINDINGS" "$(decisions_read 2770)")"
assert_json_eq "1" "$FRESH" 'length' "an escalated fingerprint is not re-dispatched either"

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

rm -rf "$TMP_D"
unset GH_MUTATION_LOG GIT_COMMON_DIR

# --- summary ----------------------------------------------------------------
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
