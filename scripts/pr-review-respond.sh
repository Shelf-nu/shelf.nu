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
mkdir -p "$(dirname "$LEDGER")"
touch "$LEDGER"

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
  key="$thread:$(printf '%s' "$body" | shasum -a 256 | cut -c1-16)"

  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    if [[ "$do_resolve" == "true" ]]; then
      printf '%s  reply+resolve  %.60s\n' "$thread" "$body"
    else
      printf '%s  reply-only     %.60s\n' "$thread" "$body"
    fi
    continue
  fi

  replied=0
  if posted "$key"; then
    printf 'skip (already replied): %s\n' "$thread" >&2
    replied=1
  elif reply_mutation "$thread" "$body"; then
    record "$key"
    replied=1
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
    resolve_mutation "$thread"
  fi
done

printf 'pr-review-respond: processed %s decision(s) for PR #%s (%s failed)\n' \
  "$n" "$PR" "$failures" >&2

# Non-zero when any reply failed, so the caller can tell a clean run from one
# that silently posted nothing.
[[ "$failures" -eq 0 ]]
