#!/usr/bin/env bash
#
# pr-review-respond.sh — execute reply + resolve decisions for a PR.
#
# Contains NO judgement: the skill decides what to say and which threads to
# close; this script only performs those decisions against the GitHub API.
#
# Usage:  scripts/pr-review-respond.sh <pr> <decisions.json> [--dry-run]
#
# decisions.json: [{ "threadId": "PRRT_…",
#                    "replyBody": "…",
#                    "resolve": true }]
#
# Idempotent: a ledger of already-posted (threadId, body-hash) pairs lives
# beside the loop state, so re-running after a crash cannot double-post a
# reply. Replies are outward-facing and cannot be taken back.
#
# @see .claude/skills/pr-review-loop/SKILL.md

set -uo pipefail

PR="${1:-}"
DECISIONS="${2:-}"
DRY_RUN="${3:-}"

[[ -z "$PR" || -z "$DECISIONS" ]] && {
  printf 'usage: pr-review-respond.sh <pr> <decisions.json> [--dry-run]\n' >&2
  exit 2
}
[[ -f "$DECISIONS" ]] || { printf 'no such file: %s\n' "$DECISIONS" >&2; exit 2; }

# The skill owns a SAME-NAMED-PATTERN object file beside this one — its own
# `<pr>.decisions.json` ledger, shaped `{seen:{...}, escalated:[...]}`. That
# is not this script's input shape. Passing it here would make `jq 'length'`
# below return a KEY COUNT instead of an element count, and every reply
# would fail against a malformed index. Fail loudly instead.
jq -e 'type == "array"' "$DECISIONS" >/dev/null 2>&1 || {
  printf 'decisions file is not a JSON array (got an object?): %s\n' "$DECISIONS" >&2
  exit 2
}

# Reject anything else in $3 rather than ignoring it. A typo like --dryrun or
# -n would otherwise fall through to the live-mutation path and post to a real
# PR — this is the one flag that must never fail open.
if [[ -n "$DRY_RUN" && "$DRY_RUN" != "--dry-run" ]]; then
  printf 'unrecognized argument: %s (did you mean --dry-run?)\n' "$DRY_RUN" >&2
  exit 2
fi

git_common_dir() {
  if [[ -n "${GIT_COMMON_DIR:-}" ]]; then printf '%s' "$GIT_COMMON_DIR"; return 0; fi
  git rev-parse --git-common-dir 2>/dev/null || printf '.git'
}

LEDGER="$(git_common_dir)/pr-review-loop/${PR}.replies"

# Fail fast, before any live mutation, if the ledger cannot be created or
# written — e.g. a read-only .git (worktree on a read-only mount, permission
# issue). An unguarded mkdir/touch failure here would silently continue into
# the loop below with a ledger that can never record a successful reply,
# turning EVERY future re-run into a duplicate-post risk with no error
# anywhere pointing at the actual cause.
mkdir -p "$(dirname "$LEDGER")" || {
  printf 'cannot create ledger directory: %s\n' "$(dirname "$LEDGER")" >&2
  exit 1
}
touch "$LEDGER" || {
  printf 'cannot write ledger file: %s\n' "$LEDGER" >&2
  exit 1
}

posted() { grep -qxF "$1" "$LEDGER"; }
record() { printf '%s\n' "$1" >> "$LEDGER"; }

reply_mutation() {
  gh api graphql -f threadId="$1" -f body="$2" -f query='
    mutation($threadId:ID!,$body:String!){
      addPullRequestReviewThreadReply(
        input:{pullRequestReviewThreadId:$threadId, body:$body}
      ){ comment{ id } } }' >/dev/null
}

resolve_mutation() {
  gh api graphql -f threadId="$1" -f query='
    mutation($threadId:ID!){
      resolveReviewThread(input:{threadId:$threadId}){ thread{ isResolved } } }' >/dev/null
}

n="$(jq 'length' "$DECISIONS")"
failures=0
for ((i = 0; i < n; i++)); do
  thread="$(jq -r ".[$i].threadId" "$DECISIONS")"
  body="$(jq -r ".[$i].replyBody" "$DECISIONS")"
  do_resolve="$(jq -r ".[$i].resolve" "$DECISIONS")"

  # `jq -r` prints the literal string "null" for a missing or JSON-null
  # threadId, same as it does for replyBody below — without this check that
  # string reaches reply_mutation as a real GraphQL argument (posting to
  # thread "null") instead of being rejected as the data problem it is. Skip
  # the mutation outright rather than letting a generic GitHub API error
  # obscure a missing/malformed decision.
  if [[ -z "$thread" || "$thread" == "null" ]]; then
    printf 'skip (missing threadId), decision index %s\n' "$i" >&2
    failures=$((failures + 1))
    continue
  fi

  # `jq -r` prints the literal string "null" for a missing or JSON-null
  # replyBody — without this check that string gets posted verbatim to a
  # public PR thread instead of the actual reply prose. Reject in both dry
  # and live mode; it is a data problem, not a live-mutation concern.
  if [[ -z "$body" || "$body" == "null" ]]; then
    printf 'skip (missing replyBody): %s\n' "$thread" >&2
    failures=$((failures + 1))
    continue
  fi

  key="$thread:$(printf '%s' "$body" | shasum -a 256 | cut -c1-16)"

  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    if [[ "$do_resolve" == "true" ]]; then
      printf '%s  reply+resolve  %.60s\n' "$thread" "$body"
    else
      printf '%s  reply-only     %.60s\n' "$thread" "$body"
    fi
    continue
  fi

  # Deliberately post-then-record, not record-then-post. A crash in the
  # narrow window between a successful reply_mutation and this record() call
  # means a re-run cannot see the ledger entry and posts a duplicate reply on
  # retry — that is a real, accepted gap (see the note below), but the
  # alternative (record the key BEFORE attempting the post) is worse: a
  # mutation that then fails (network blip, rate limit, `gh` crash) leaves
  # the ledger falsely claiming success, so a genuinely-never-posted reply is
  # silently swallowed forever with no retry path — worse than "double replies",
  # because replies are outward-facing and cannot be taken back, and a
  # visible duplicate is at least something a human can see and clean up,
  # unlike a silently-lost one.
  #
  # What IS fixed here: record()'s own exit status was previously ignored,
  # so a ledger write that fails AFTER a successful post (disk full, ledger
  # file went unwritable mid-run) still fell through as if nothing had gone
  # wrong — `replied=1`, thread resolved, no error anywhere, even though the
  # ledger can no longer prove the reply happened. That's the actual
  # "silent success masking a future duplicate" mechanism, and it's a
  # containable, mechanical thing to guard, unlike the crash-mid-syscall
  # window above.
  #
  # NOT implemented: a durable idempotency marker embedded in the reply body
  # plus a pre-mutation query of the thread's existing comments to detect an
  # ambiguous prior attempt, and a PR-scoped lock against concurrent runs.
  # Declined as disproportionate to what this script actually needs: it is
  # invoked once per triage round by a single skill instance per PR — never
  # concurrently against the same PR, so there is no concurrent-writer
  # scenario to lock against — and a reconciliation query before EVERY reply
  # would double this script's GitHub API traffic to guard a failure window
  # (a process kill in the few hundred ms between the mutation returning and
  # the next line running) that is both rare and, per the paragraph above,
  # already resolved in the direction that fails visibly rather than
  # silently. Revisit if duplicate replies are ever actually observed in
  # practice.
  replied=0
  if posted "$key"; then
    printf 'skip (already replied): %s\n' "$thread" >&2
    replied=1
  elif reply_mutation "$thread" "$body"; then
    if record "$key"; then
      replied=1
    else
      printf 'reply posted but ledger write FAILED, not resolving: %s\n' "$thread" >&2
      failures=$((failures + 1))
    fi
  else
    printf 'reply FAILED, not resolving: %s\n' "$thread" >&2
    failures=$((failures + 1))
  fi

  # Resolve ONLY when this thread carries a reply — posted just now, or
  # confirmed posted by an earlier run via the ledger. Resolving a thread
  # whose reply never landed marks it "addressed" on a live PR that
  # colleagues and bots read, with no explanation anywhere on it. That is
  # strictly worse than leaving it open.
  if [[ "$replied" -eq 1 && "$do_resolve" == "true" ]]; then
    if ! resolve_mutation "$thread"; then
      printf 'resolve FAILED (reply posted, thread stays open): %s\n' "$thread" >&2
      failures=$((failures + 1))
    fi
  fi
done

printf 'pr-review-respond: processed %s decision(s) for PR #%s (%s failed)\n' \
  "$n" "$PR" "$failures" >&2

# Non-zero when any reply failed, so the caller can tell a clean run from one
# that silently posted nothing.
[[ "$failures" -eq 0 ]]
