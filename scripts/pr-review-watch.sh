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
#
# The red set must cover EVERY blocking conclusion GitHub emits, not just the
# obvious three. `action_required` (workflow awaiting approval) and
# `startup_failure` (bad workflow YAML) are both blocking and both routine;
# omitting them makes a blocked PR read as clean and lets the loop settle on
# it. `neutral` and `skipped` are deliberately NOT red — GitHub treats those
# as non-blocking.
collect_checks() {
  gh api "repos/$REPO/commits/$1/check-runs" | jq '{
    red: [.check_runs[] | select(.conclusion == "failure"
        or .conclusion == "timed_out" or .conclusion == "cancelled"
        or .conclusion == "action_required"
        or .conclusion == "startup_failure")] | length,
    pending: [.check_runs[] | select(.status != "completed")] | length
  }'
}

# --- dedup -------------------------------------------------------------------

# Findings with no decided verdict in state.
#
# Suppression covers EVERY decided verdict, not just rejections. A bot
# re-flagging something already fixed is at least as common as one re-flagging
# something rejected, and re-triaging it burns a whole round to reach the same
# answer. This is what stops the fix -> re-review -> re-post cycle.
unseen_findings() {
  jq -n --argjson f "$1" --argjson s "$2" \
    '[$f[] | select(($s.seen[.fingerprint] // null) == null)]'
}

repost_count() {
  printf '%s' "$2" | jq -r --arg fp "$1" '.seen[$fp].reposts // 0'
}

# --- events ------------------------------------------------------------------

# Last error reason emitted, for de-duplication. A process-lifetime shell
# variable rather than state, because the failure that most needs suppressing
# is a REJECTED STATE WRITE — which by definition cannot persist a guard.
LAST_ERROR=""

# Emit an ERROR only on transition. A persistent fault (revoked gh auth, a
# read-only git dir) would otherwise emit one line per poll forever — the same
# self-destruct the per-event transition guards exist to prevent, since
# monitors that emit too much are killed automatically.
emit_error_once() {
  local reason="$1"
  [[ "$reason" == "$LAST_ERROR" ]] && return 0
  LAST_ERROR="$reason"
  emit ERROR "$(jq -c -n --arg r "$reason" '{reason:$r}')"
}

# One line of JSON per event. Stdout is the Monitor's notification stream, so
# this stays terse by contract: the payload belongs in the state file.
emit() {
  # Note: `${2:-{}}` cannot be written directly — the inner `}` closes the
  # parameter expansion — and escaping it as `\{\}` yields the literal
  # `\{}`, which jq rejects. Default explicitly instead.
  local payload="${2:-}"
  [[ -z "$payload" ]] && payload='{}'
  jq -c -n --arg event "$1" --argjson payload "$payload" '{event:$event} + $payload'
}

# The remote SHA, once origin/<branch> contains local HEAD. Replies must cite a
# commit that actually exists on the remote, so RESPOND waits on this.
detect_push() {
  local branch="$1" state="$2" remote last
  git fetch origin "$branch" --quiet 2>/dev/null
  remote="$(git rev-parse "origin/$branch" 2>/dev/null)" || return 0
  last="$(printf '%s' "$state" | jq -r '.lastPushedSha // ""')"
  [[ "$remote" == "$last" ]] && return 0
  git merge-base --is-ancestor HEAD "$remote" 2>/dev/null || return 0
  printf '%s' "$remote"
}

# --- polling -------------------------------------------------------------------

# One poll.
#
# Two invariants make this safe to run unattended as a background monitor:
#
# 1. Events are BUFFERED and flushed only AFTER the state that suppresses
#    them is durably written. Emitting first means a rejected state_write
#    leaves one-shot transitions announced but unrecorded, so they re-fire on
#    every later poll — a notification storm with no error anywhere.
# 2. EVERY event is transition-guarded against the persisted state. A
#    condition that merely persists (4 undecided findings, a red check) is
#    announced once, not once per minute. Monitors that emit too much are
#    killed automatically, so an unguarded event is a self-destruct.
#
# Numeric comparisons are done inside jq (`jq -e 'x > 0'`), never with bash
# arithmetic on captured output: under `set -u`, `[[ "$(...)" -gt 0 ]]` on a
# non-numeric value aborts the whole script with exit status 0, which a
# supervisor reads as a clean shutdown.
poll_once() {
  local pr="$1" state findings fresh reviews issues ood checks sha pushed pushed_at e
  local -a events=()

  state="$(state_read "$pr")" || {
    emit_error_once "state unreadable"; return 1; }

  findings="$(collect_threads "$pr" | shape_findings)" || {
    emit_error_once "collect_threads failed"; return 1; }
  fresh="$(unseen_findings "$findings" "$state")"

  reviews="$(collect_reviews "$pr")" || reviews="[]"
  issues="$(collect_issue_comments "$pr")" || issues="[]"
  ood="$(out_of_diff_reviews "$reviews")"
  sha="$(head_sha "$pr")"
  checks="$(collect_checks "$sha")" || checks='{"red":0,"pending":0}'

  # Copilot quota — transition-guarded.
  if copilot_quota_exhausted "$reviews"; then
    if [[ "$(printf '%s' "$state" | jq -r '.copilotExpected')" == "true" ]]; then
      state="$(printf '%s' "$state" | jq '.copilotExpected = false')"
      events+=("COPILOT_QUOTA|{\"reason\":\"copilot reported a quota limit; not waiting on it\"}")
    fi
  else
    state="$(printf '%s' "$state" | jq '.copilotExpected = true')"
  fi

  # Push — guarded by lastPushedSha, which main seeds so the first poll of an
  # already-pushed branch does not announce a push that never happened.
  pushed="$(detect_push "$(printf '%s' "$state" | jq -r '.branch')" "$state")"
  if [[ -n "$pushed" ]]; then
    # Record WHEN as well as WHAT: reviewed_head_map needs a timestamp to
    # decide whether a bot's review post-dates the push, and CodeRabbit and
    # Copilot publish no reviewed-SHA marker at all.
    pushed_at="$(git show -s --format=%cI "$pushed" 2>/dev/null || printf '')"
    state="$(printf '%s' "$state" \
      | jq --arg sha "$pushed" --arg at "$pushed_at" \
           '.lastPushedSha = $sha | .lastPushedAt = $at')"
    events+=("PUSHED|$(jq -c -n --arg sha "$pushed" '{sha:$sha}')")
  fi

  # Which SHA each bot has reviewed. Quiescence condition #1 is computed from
  # this map, so leaving it unwritten makes "have the bots caught up?"
  # permanently unanswerable — the loop could never correctly report clean.
  state="$(jq -n --argjson s "$state" \
    --argjson rh "$(reviewed_head_map "$reviews" \
      "$(printf '%s' "$state" | jq -r '.lastPushedAt // "1970-01-01T00:00:00Z"')")" \
    '$s + {reviewedHead: $rh}')"

  # Findings — announce only fingerprints not already announced. `announced`
  # is separate from `seen`: `seen` holds DECIDED verdicts, `announced` holds
  # "the human has been told", which is what stops re-notification while a
  # finding sits undecided between rounds.
  local newbot newhuman
  newbot="$(jq -n --argjson f "$fresh" --argjson s "$state" \
    '[$f[] | select(.kind=="bot") | select((($s.announced // {})[.fingerprint]) == null)]')"
  newhuman="$(jq -n --argjson f "$fresh" --argjson s "$state" \
    '[$f[] | select(.kind=="human") | select((($s.announced // {})[.fingerprint]) == null)]')"

  if printf '%s' "$newbot" | jq -e 'length > 0' >/dev/null; then
    events+=("NEW_FINDINGS|$(printf '%s' "$newbot" | jq -c '{threads: length}')")
  fi
  if printf '%s' "$newhuman" | jq -e 'length > 0' >/dev/null; then
    events+=("HUMAN_COMMENT|$(printf '%s' "$newhuman" | jq -c '{count: length}')")
  fi
  # `announced` is the set currently OUTSTANDING, deliberately NOT a growing
  # union. A union outlives the finding: announced -> never decided ->
  # bot resolves its own thread -> bot re-posts the same finding (same
  # fingerprint, by design) would stay silent forever while `seen` is still
  # empty, i.e. while nothing has actually been judged. Rebuilding it each
  # poll keeps still-pending findings quiet and lets a vanished-and-returned
  # finding speak again. Decided findings are suppressed by `seen`, upstream.
  state="$(jq -n --argjson s "$state" --argjson f "$fresh" \
    '$s + {announced: ([$f[] | {(.fingerprint): true}] | add // {})}')"

  # A DECIDED finding re-posted by the bot under a NEW thread id. Same
  # fingerprint + different thread = a genuine re-post; matching on thread id
  # too is what stops this ticking up merely because one thread stays open
  # across polls. The skill's three-repost escape hatch is the runaway guard
  # that replaced the round cap, and it reads this counter — without it a
  # re-posting bot gets auto-replied to forever.
  state="$(jq -n --argjson s "$state" --argjson f "$findings" '
    $s + {seen: (reduce ($f[]
                 | select((($s.seen // {})[.fingerprint]) != null)
                 | select(.threadId != ($s.seen[.fingerprint].threadId)))
                 as $x (($s.seen // {});
                   .[$x.fingerprint].reposts  = ((.[$x.fingerprint].reposts // 0) + 1)
                 | .[$x.fingerprint].threadId = $x.threadId))}')"

  # Out-of-diff findings get their OWN event, deduped by review id.
  #
  # They must NOT ride inside NEW_FINDINGS: that event is gated on fresh bot
  # threads, so on a PR whose threads are all resolved the out-of-diff set
  # would be persisted and never announced. These findings have no thread at
  # all — this event is the only way they ever reach the human.
  local newood
  newood="$(jq -n --argjson o "$ood" --argjson s "$state" \
    '[$o[] | select((($s.announcedOutOfDiff // {})[(.reviewId|tostring)]) == null)]')"
  if printf '%s' "$newood" | jq -e 'length > 0' >/dev/null; then
    events+=("OUT_OF_DIFF|$(printf '%s' "$newood" | jq -c '{reviews: length}')")
  fi
  state="$(jq -n --argjson s "$state" --argjson o "$ood" \
    '$s + {announcedOutOfDiff: (($s.announcedOutOfDiff // {})
                                + ([$o[] | {(.reviewId|tostring): true}] | add // {}))}')"

  # --- top-level PR comments ------------------------------------------------
  #
  # Review threads carry only INLINE comments. A teammate writing in the PR's
  # conversation box — the common way people comment — is invisible without
  # this, and so is React Doctor, whose findings arrive as a sticky bot
  # comment rather than a thread.
  local allhumanc newhumanc alldoctor newdoctor
  allhumanc="$(printf '%s' "$issues" | jq '[.[]
    | select((.user.login | endswith("[bot]")) | not)
    | {id, author: .user.login, body, createdAt: .created_at}]')"
  newhumanc="$(jq -n --argjson c "$allhumanc" --argjson s "$state" \
    '[$c[] | select((($s.announcedComments // {})[(.id|tostring)]) == null)]')"

  alldoctor="$(printf '%s' "$issues" | jq '[.[]
    | select(.user.login == "github-actions[bot]")
    | select(.body | test("React Doctor"))
    | {id, author: .user.login, body, updatedAt: .updated_at}]')"
  # Keyed by id AND updated_at, because React Doctor REWRITES its sticky
  # comment in place. Id-only dedup would announce the first version and
  # silence every later one — including newly-introduced errors, which is the
  # only part of its output that fails a PR.
  newdoctor="$(jq -n --argjson c "$alldoctor" --argjson s "$state" \
    '[$c[] | select((($s.announcedComments // {})[((.id|tostring) + ":" + (.updatedAt // ""))]) == null)]')"

  if printf '%s' "$newhumanc" | jq -e 'length > 0' >/dev/null; then
    events+=("HUMAN_COMMENT|$(printf '%s' "$newhumanc" | jq -c '{count: length, source: "pr-comment"}')")
  fi
  if printf '%s' "$newdoctor" | jq -e 'length > 0' >/dev/null; then
    events+=("DOCTOR|$(printf '%s' "$newdoctor" | jq -c '{comments: length}')")
  fi

  # NOTE: `announcedComments` IS a growing union, deliberately unlike
  # `announced`. A comment id cannot vanish and return the way a re-posted
  # finding can, and the doctor key already carries its content version — so
  # there is nothing here for a rebuild-each-poll to recover, and a union
  # avoids re-announcing a comment that is simply still there.
  state="$(jq -n --argjson s "$state" --argjson h "$allhumanc" --argjson d "$alldoctor" \
    --argjson nh "$newhumanc" --argjson nd "$newdoctor" '
    $s + {humanComments: $h, doctor: $d,
          announcedComments: (($s.announcedComments // {})
            + ([$nh[] | {(.id|tostring): true}] | add // {})
            + ([$nd[] | {((.id|tostring) + ":" + (.updatedAt // "")): true}] | add // {}))}')"

  # Checks — emit only when the classification CHANGES and is red.
  if [[ "$(printf '%s' "$checks" | jq -cS '.')" \
     != "$(printf '%s' "$state" | jq -cS '.checks // null')" ]] \
     && printf '%s' "$checks" | jq -e '.red > 0' >/dev/null; then
    events+=("CHECKS_RED|$(printf '%s' "$checks" | jq -c '.')")
  fi

  state="$(jq -n --argjson s "$state" --argjson f "$fresh" --argjson o "$ood" \
    --argjson c "$checks" --arg sha "$sha" \
    '$s + {pending: $f, outOfDiff: $o, checks: $c, headSha: $sha}')"

  printf '%s' "$state" | state_write "$pr" || {
    emit_error_once "state write rejected; events withheld"; return 1; }

  # A poll got all the way through: the next distinct fault is newsworthy again.
  LAST_ERROR=""

  # Flush only now that the suppressing state is durable. The `${a[@]+...}`
  # form is required: under `set -u`, bash 3.2 treats "${a[@]}" on an EMPTY
  # array as an unbound variable and aborts.
  for e in ${events[@]+"${events[@]}"}; do
    emit "${e%%|*}" "${e#*|}"
  done
}

# --- entrypoint ------------------------------------------------------------

main() {
  local pr="${1:-}" branch seed
  [[ -z "$pr" ]] && { printf 'usage: pr-review-watch.sh <pr-number>\n' >&2; exit 2; }
  branch="$(git rev-parse --abbrev-ref HEAD)"
  state_init "$pr" "$branch"

  # Seed lastPushedSha WITHOUT emitting. At loop start the branch is normally
  # already pushed; leaving it null makes the first poll announce a PUSHED
  # that never happened, which would drive the reply step to post
  # "Fixed in <sha>" before any fix exists.
  if [[ "$(state_read "$pr" | jq -r '.lastPushedSha')" == "null" ]]; then
    # --verify --quiet is required: a bare `git rev-parse origin/<branch>`
    # ECHOES ITS UNRESOLVED ARGUMENT on stdout when the ref is missing (the
    # normal case for a branch not yet pushed), so `seed` would be the string
    # "origin/<branch>" and that non-SHA would be written into the very field
    # this seeding exists to make trustworthy.
    seed="$(git rev-parse --verify --quiet "origin/$branch" 2>/dev/null || true)"
    [[ -n "$seed" ]] && state_read "$pr" \
      | jq --arg s "$seed" '.lastPushedSha = $s' | state_write "$pr"
  fi

  printf 'pr-review-watch: watching PR #%s every %ss\n' "$pr" "$POLL_INTERVAL" >&2
  while :; do
    # poll_once owns its own error reporting (it emits a specific ERROR event
    # per failure path); a second generic ERROR here would double-notify.
    poll_once "$pr" || true
    sleep "$POLL_INTERVAL"
  done
}

if [[ "${PR_REVIEW_WATCH_LIB_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
