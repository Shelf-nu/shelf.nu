#!/usr/bin/env bash
#
# pr-review-watch.sh — PR review feed poller for the /pr-review-loop skill.
#
# Turns GitHub review state into a deduplicated, actionable change feed.
# Contains ALL polling and dedup logic and NO judgement: it decides *that*
# something changed, never *what to do* about it.
#
# Usage:  scripts/pr-review-watch.sh <pr-number>
# Emits:  one-line JSON events on stdout, consumed by the Monitor tool.
#         Stdout is deliberately terse — every line becomes a chat
#         notification, so the full payload goes to the state file instead.
# State:  $(git rev-parse --git-common-dir)/pr-review-loop/<pr>.json
#
# @see .claude/skills/pr-review-loop/SKILL.md
# @see superpowers/2026-07-30-pr-review-loop-design.md

set -uo pipefail

REPO="${PR_REVIEW_REPO:-Shelf-nu/shelf.nu}"
POLL_INTERVAL="${PR_REVIEW_POLL_INTERVAL:-60}"

# Bot logins WITHOUT the "[bot]" suffix. GraphQL's author.login omits the
# suffix that REST's user.login includes ("coderabbitai" vs
# "coderabbitai[bot]") — verified against PR #2770. Normalize before matching
# or every bot thread is misclassified as a human comment.
BOT_LOGINS="coderabbitai chatgpt-codex-connector copilot-pull-request-reviewer github-actions"

# --- state -----------------------------------------------------------------

# Resolve the shared git dir so state is keyed per-PR across worktrees.
git_common_dir() {
  if [[ -n "${GIT_COMMON_DIR:-}" ]]; then printf '%s' "$GIT_COMMON_DIR"; return 0; fi
  git rev-parse --git-common-dir 2>/dev/null || printf '.git'
}

state_path() { printf '%s/pr-review-loop/%s.json' "$(git_common_dir)" "$1"; }

# Create the state file if absent. Never clobbers an existing one, so
# re-invoking the loop on the same PR resumes instead of re-triaging.
state_init() {
  local p; p="$(state_path "$1")"
  mkdir -p "$(dirname "$p")"
  # Self-heal: an existing but unparseable file (truncated by a killed
  # writer) must be rebuilt, not trusted. A bare -f test would hand back a
  # corrupt file forever.
  if [[ -f "$p" ]] && jq -e 'type == "object"' "$p" >/dev/null 2>&1; then return 0; fi
  jq -n --argjson pr "$1" --arg branch "$2" '{
    pr: $pr, branch: $branch, round: 0, lastPushedSha: null,
    copilotExpected: true, reviewedHead: {}, seen: {},
    escalated: [], humanThreads: [], quiescent: false
  }' > "$p"
}

state_read() { cat "$(state_path "$1")"; }

# Atomic, VALIDATED write.
#
# `cat` exits 0 even when its upstream producer died having written zero
# bytes, so an unguarded `cat > tmp && mv` promotes an EMPTY file over the
# last-good state. That destroys the seen map, and the loop then re-triages
# the whole PR and re-answers threads it already answered. Validate the
# payload parses before letting it replace anything.
state_write() {
  local p tmp
  p="$(state_path "$1")"
  tmp="$(mktemp "${p}.XXXXXX")" || return 1
  cat > "$tmp"
  # `jq empty` alone is NOT a guard: it exits 0 for zero-byte input,
  # whitespace-only input, `null`, and arrays — every shape a dead upstream
  # producer can leave behind. Require a real JSON OBJECT (verified
  # empirically against all six cases) before this may replace the state.
  jq -e 'type == "object"' "$tmp" >/dev/null 2>&1 || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$p"
}

# --- identity --------------------------------------------------------------

normalize_login() { printf '%s' "${1%\[bot\]}"; }

is_bot() {
  local login; login="$(normalize_login "$1")"
  case " $BOT_LOGINS " in
    *" $login "*) return 0 ;;
  esac
  return 1
}

# --- fingerprinting --------------------------------------------------------

# Strip everything that varies between renderings of the SAME finding:
# HTML comments, badge images, line references, and the react-boilerplate.
# Without this, a bot re-posting a finding after a rebase looks brand new and
# the loop re-triages work it has already decided.
normalize_body() {
  printf '%s' "$1" | perl -0777 -pe '
    s/<!--.*?-->//gs;
    s/!\[[^\]]*\]\([^)]*\)//g;
    s/around lines?\s+\d+\s*-?\s*\d*//gi;
    s/Useful\?\s*React with.*//s;
    s/\s+/ /g;
    s/^\s+|\s+$//g;
  '
}

# Prefer CodeRabbit's own stable marker when present — it survives rewording
# that our normalization would not. Otherwise hash author + path + body.
finding_fingerprint() {
  local author="$1" path="$2" body="$3" cr
  cr="$(printf '%s' "$body" | grep -oE 'cr-comment:v1:[a-f0-9]+' | head -1)"
  if [[ -n "$cr" ]]; then printf '%s' "$cr"; return 0; fi
  printf '%s|%s|%s' "$(normalize_login "$author")" "$path" "$(normalize_body "$body")" \
    | shasum -a 256 | cut -c1-16
}

# --- collection ------------------------------------------------------------

THREADS_QUERY='query($owner:String!,$name:String!,$pr:Int!,$cursor:String){
  repository(owner:$owner,name:$name){ pullRequest(number:$pr){
    headRefOid
    reviewThreads(first:100, after:$cursor){
      pageInfo{hasNextPage endCursor}
      nodes{ id isResolved isOutdated path line
        comments(first:20){nodes{id databaseId author{login} body createdAt}} } } } } }'

# One page of review threads. The cursor variable is omitted rather than sent
# empty — GraphQL rejects after:"" but accepts a null/absent cursor.
gql_threads_page() {
  local pr="$1" cursor="${2:-}"
  if [[ -n "$cursor" ]]; then
    gh api graphql -f owner="${REPO%%/*}" -f name="${REPO##*/}" -F pr="$pr" \
      -f cursor="$cursor" -f query="$THREADS_QUERY"
  else
    gh api graphql -f owner="${REPO%%/*}" -f name="${REPO##*/}" -F pr="$pr" \
      -f query="$THREADS_QUERY"
  fi
}

head_sha() {
  gql_threads_page "$1" | jq -r '.data.repository.pullRequest.headRefOid'
}

# All review threads, following pagination. Returns a raw node array.
collect_threads() {
  local pr="$1" cursor="" page all="[]" has
  while :; do
    page="$(gql_threads_page "$pr" "$cursor")" || return 1
    all="$(jq -n --argjson a "$all" \
      --argjson b "$(printf '%s' "$page" \
        | jq '.data.repository.pullRequest.reviewThreads.nodes')" \
      '$a + $b')"
    has="$(printf '%s' "$page" \
      | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')"
    [[ "$has" != "true" ]] && break
    cursor="$(printf '%s' "$page" \
      | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')"
  done
  printf '%s' "$all"
}

# Raw thread nodes (stdin) -> findings array (stdout).
#
# Resolved threads are dropped. OUTDATED threads are kept but flagged: an
# outdated thread only means the code moved under it, not that the finding
# died — deciding that is the triager's job, and it returns STALE when so.
shape_findings() {
  local raw n i out="[]"
  raw="$(cat)"
  n="$(printf '%s' "$raw" | jq 'length')"
  for ((i = 0; i < n; i++)); do
    local t resolved outdated author path line body kind fp
    t="$(printf '%s' "$raw" | jq -c ".[$i]")"
    resolved="$(printf '%s' "$t" | jq -r '.isResolved')"
    [[ "$resolved" == "true" ]] && continue
    outdated="$(printf '%s' "$t" | jq -r '.isOutdated')"
    author="$(printf '%s' "$t" | jq -r '.comments.nodes[0].author.login // "unknown"')"
    path="$(printf '%s' "$t" | jq -r '.path // ""')"
    line="$(printf '%s' "$t" | jq -r '.line // 0')"
    body="$(printf '%s' "$t" | jq -r '.comments.nodes[0].body // ""')"
    if is_bot "$author"; then kind="bot"; else kind="human"; fi
    fp="$(finding_fingerprint "$author" "$path" "$body")"
    out="$(jq -n --argjson acc "$out" \
      --arg fp "$fp" \
      --arg id "$(printf '%s' "$t" | jq -r '.id')" \
      --arg author "$author" --arg path "$path" --arg kind "$kind" \
      --arg body "$body" \
      --argjson line "$line" --argjson outdated "$outdated" \
      '$acc + [{fingerprint:$fp, threadId:$id, author:$author, path:$path,
                line:$line, kind:$kind, outdated:$outdated, body:$body}]')"
  done
  printf '%s' "$out"
}

collect_reviews() {
  gh api "repos/$REPO/pulls/$1/reviews"
}

collect_issue_comments() {
  gh api "repos/$REPO/issues/$1/comments"
}

# Copilot regularly reports "unable to review ... quota limit" instead of a
# real review. When that is the latest word from Copilot the loop must stop
# expecting it — otherwise quiescence never arrives. Absence of a Copilot
# review is NOT the same as "nothing to fix".
copilot_quota_exhausted() {
  local latest
  latest="$(printf '%s' "$1" | jq -r '
    [.[] | select(.user.login == "copilot-pull-request-reviewer[bot]")]
    | last | .body // ""')"
  [[ "$latest" =~ [Uu]nable\ to\ review.*quota\ limit ]]
}

# CodeRabbit posts findings it cannot attach inline into the review BODY,
# behind a "> [!CAUTION] Some comments are outside the diff" banner. These
# have no thread, so a thread-only poller silently drops them.
out_of_diff_reviews() {
  printf '%s' "$1" | jq '[
    .[]
    | select(.body | test("outside the diff"))
    | {reviewId: .id, author: .user.login, body: .body}
  ]'
}

# Which commit each bot has reviewed. Mechanism differs per bot (verified
# against #2770): Codex publishes "**Reviewed commit:** `<sha>`"; CodeRabbit
# and Copilot publish nothing and fall back to submitted_at > push time.
reviewed_head_map() {
  local reviews="$1" since="$2"
  printf '%s' "$reviews" | jq --arg since "$since" '
    reduce (.[] | select(.user.login | endswith("[bot]"))) as $r ({};
      . + {
        ($r.user.login):
          (($r.body // "") | capture("\\*\\*Reviewed commit:\\*\\* `(?<sha>[0-9a-f]+)`").sha
           // (if $r.submitted_at > $since then "timestamp" else .[$r.user.login] end))
      })
    | with_entries(select(.value != null))'
}

# gh 2.32.1 has no `gh pr checks --json`, so use the REST check-runs endpoint.
collect_checks() {
  gh api "repos/$REPO/commits/$1/check-runs" | jq '{
    red: [.check_runs[] | select(.conclusion == "failure"
        or .conclusion == "timed_out" or .conclusion == "cancelled")] | length,
    pending: [.check_runs[] | select(.status != "completed")] | length
  }'
}

# --- entrypoint ------------------------------------------------------------

main() {
  local pr="${1:-}"
  [[ -z "$pr" ]] && { printf 'usage: pr-review-watch.sh <pr-number>\n' >&2; exit 2; }
  state_init "$pr" "$(git rev-parse --abbrev-ref HEAD)"
  printf 'pr-review-watch: watching PR #%s every %ss\n' "$pr" "$POLL_INTERVAL" >&2
}

if [[ "${PR_REVIEW_WATCH_LIB_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
