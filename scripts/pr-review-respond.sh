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

  if posted "$key"; then
    printf 'skip (already replied): %s\n' "$thread" >&2
  else
    reply_mutation "$thread" "$body" && record "$key"
  fi

  [[ "$do_resolve" == "true" ]] && resolve_mutation "$thread"
done

printf 'pr-review-respond: processed %s decision(s) for PR #%s\n' "$n" "$PR" >&2
