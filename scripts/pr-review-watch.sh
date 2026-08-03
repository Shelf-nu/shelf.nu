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
# State:  $(git rev-parse --git-common-dir)/pr-review-loop/<pr>.json — this
#         script's OWN state, written every poll.
#
# Single-writer-per-file: the skill owns a SEPARATE file,
# .../pr-review-loop/<pr>.decisions.json, holding triage verdicts. This
# script only ever READS it (decisions_read) — poll_once holds state across
# four network round trips per poll, so a write from here would silently
# discard whatever the skill wrote in that window, including reply prose
# that cannot be recovered. See decisions_read below.
#
# @see .claude/skills/pr-review-loop/SKILL.md
# @see superpowers/2026-07-30-pr-review-loop-design.md

set -uo pipefail

# Never let a bare `git` subprocess block the poll loop on an interactive
# credential prompt. This runs unattended as a background monitor with no
# tty attached, so an unanswered prompt would hang forever — silently, like
# every other failure mode this file guards against. Covers every git
# invocation below (detect_push's fetch, git_commit_iso_utc's show, etc.),
# not just the one wrapped with a timeout below.
export GIT_TERMINAL_PROMPT=0

REPO="${PR_REVIEW_REPO:-Shelf-nu/shelf.nu}"
POLL_INTERVAL="${PR_REVIEW_POLL_INTERVAL:-60}"

# collect_threads gives up after this many pages rather than looping
# forever. 100 threads/page (THREADS_QUERY's page size, below) * 20 pages is
# far beyond any real PR's thread count.
COLLECT_THREADS_MAX_PAGES="${PR_REVIEW_MAX_THREAD_PAGES:-20}"

# Bot logins WITHOUT the "[bot]" suffix. GraphQL's author.login omits the
# suffix that REST's user.login includes ("coderabbitai" vs
# "coderabbitai[bot]") — verified against PR #2770. Normalize before matching
# or every bot thread is misclassified as a human comment.
BOT_LOGINS="coderabbitai chatgpt-codex-connector copilot-pull-request-reviewer github-actions"

# The subset of BOT_LOGINS that actually posts a PR REVIEW (as opposed to a
# thread comment or, for github-actions, React Doctor's sticky ISSUE
# comment). Quiescence condition #1 needs to know which bots to wait on for
# `.reviewedHead` — including github-actions there would make that condition
# permanently unsatisfiable, since it never appears in the reviews endpoint.
REVIEW_BOT_LOGINS="coderabbitai chatgpt-codex-connector copilot-pull-request-reviewer"

# --- state -----------------------------------------------------------------

# Resolve the shared git dir so state is keyed per-PR across worktrees.
git_common_dir() {
  if [[ -n "${GIT_COMMON_DIR:-}" ]]; then printf '%s' "$GIT_COMMON_DIR"; return 0; fi
  git rev-parse --git-common-dir 2>/dev/null || printf '.git'
}

state_path() { printf '%s/pr-review-loop/%s.json' "$(git_common_dir)" "$1"; }

# Create the state file if absent. Never clobbers an existing one, so
# re-invoking the loop on the same PR resumes instead of re-triaging.
#
# No `seen` / `escalated` here — those are DECISIONS fields, owned and
# written exclusively by the skill (see decisions_read). This state carries
# only what the watcher itself computes each poll.
state_init() {
  local p; p="$(state_path "$1")"
  mkdir -p "$(dirname "$p")"
  # Self-heal: an existing but unparseable file (truncated by a killed
  # writer) must be rebuilt, not trusted. A bare -f test would hand back a
  # corrupt file forever.
  if [[ -f "$p" ]] && jq -e 'type == "object"' "$p" >/dev/null 2>&1; then return 0; fi
  jq -n --argjson pr "$1" --arg branch "$2" '{
    pr: $pr, branch: $branch, round: 0,
    lastPushedSha: null, lastPushedAt: null,
    copilotExpected: true, reviewedHead: {}, repostCounts: {}
  }' > "$p"
}

state_read() { cat "$(state_path "$1")"; }

# Refresh `.branch` to the CURRENT branch — every invocation, unlike
# state_init, which deliberately never touches an existing file. Without
# this, a state file left over from watching this PR number on a DIFFERENT
# branch keeps its stale `.branch` forever (state_init only fills in a
# missing file, so resuming never corrects it). detect_push reads `.branch`
# every poll, so a stale value makes it watch the wrong ref: a real push is
# never seen, PUSHED never fires, RESPOND never runs, and every thread sits
# unanswered — completely silently, same as every other failure this round
# closes. main() calls this unconditionally, after state_init.
state_refresh_branch() {
  local pr="$1" branch="$2"
  state_read "$pr" | jq --arg b "$branch" '.branch = $b' | state_write "$pr"
}

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

# --- decisions (skill-owned; READ ONLY from here) ---------------------------

decisions_path() { printf '%s/pr-review-loop/%s.decisions.json' "$(git_common_dir)" "$1"; }

# The skill's verdict ledger — `.seen[<fingerprint>]`, `.escalated[]`,
# `.addressedOutOfDiff`. This script must NEVER write this file (see the
# file header); decisions_read is its only access to it.
#
# Returns a sane empty object when the file is absent or corrupt: a PR
# nothing has been decided on yet, or a session resumed before the skill's
# first write. Every reader downstream defaults missing keys
# (`.seen // {}`, `.escalated // []`), so `{}` is a valid "nothing decided
# yet" document, not a special case callers need to guard against.
decisions_read() {
  local p; p="$(decisions_path "$1")"
  if [[ -f "$p" ]] && jq -e 'type == "object"' "$p" >/dev/null 2>&1; then
    cat "$p"
  else
    printf '{}'
  fi
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

# --- time --------------------------------------------------------------------

# Current instant, Z-suffixed. Used both for headShaFirstSeenAt (§6.7's
# 20-minute silent-bot clock) and for stamping a just-detected push — NOT for
# main()'s seed, which deliberately keeps the commit date (see seed_push_state).
now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Normalize an ISO 8601 timestamp — already Z-suffixed, or carrying a numeric
# offset — to a Z-suffixed UTC string.
#
# jq's `fromdateiso8601` requires the literal "Z" suffix and cannot parse a
# numeric offset AT ALL (verified against jq 1.7.1: it rejects both "+03:00"
# and even "+00:00", and `strptime(...."%z")` fares no better). git emits the
# COMMITTER'S OWN offset, never "Z" — so anything reaching jq's date
# functions has to be normalized in bash first, before it ever gets there.
iso8601_to_utc_z() {
  local ts="$1" compact
  [[ -z "$ts" ]] && { printf ''; return 0; }
  case "$ts" in
    *Z) printf '%s' "$ts"; return 0 ;;
  esac
  # BSD `date`'s %z does not accept a colon in the offset ("-07:00"); strip
  # it to "-0700" before parsing.
  compact="${ts%:??}${ts: -2}"
  TZ=UTC date -j -f '%Y-%m-%dT%H:%M:%S%z' "$compact" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || printf ''
}

# UTC, Z-suffixed ISO 8601 timestamp for a commit's committer date.
git_commit_iso_utc() {
  local ts
  ts="$(git show -s --format=%cI "$1" 2>/dev/null)" || return 0
  iso8601_to_utc_z "$ts"
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

# True for a resolvable 40-char lowercase-hex SHA, false for anything else —
# including the literal string "null", which is exactly what head_sha's `-r`
# renders for a bad PR number: GitHub's GraphQL API returns
# `repository.pullRequest: null` with HTTP 200 and `gh` exits 0, so nothing
# upstream of this ever fails loudly. Isolated from main() so both the
# accept and reject paths are unit-testable without entering main's poll
# loop.
validate_head_sha() {
  local sha="$1"
  [[ "${#sha}" -eq 40 && "$sha" =~ ^[0-9a-f]+$ ]]
}

# All review threads, following pagination. Returns a raw node array.
#
# Bounded to COLLECT_THREADS_MAX_PAGES pages. A misbehaving API returning
# hasNextPage:true with a repeating cursor would otherwise spin the poll loop
# forever, emitting nothing on every iteration — the exact silent-hang
# failure mode this whole file exists to avoid.
#
# Exit codes distinguish two different failures: 1 is an outright gql
# failure (existing behavior, unchanged — the caller has nothing usable and
# must bail). 2 is "the page cap fired" — $all still holds every page
# collected before the limit, so stdout carries real (if incomplete) data;
# the caller (poll_once) decides whether to still use it rather than this
# function silently discarding a partial result.
collect_threads() {
  local pr="$1" cursor="" page all="[]" has pages=0
  while :; do
    page="$(gql_threads_page "$pr" "$cursor")" || return 1
    all="$(jq -n --argjson a "$all" \
      --argjson b "$(printf '%s' "$page" \
        | jq '.data.repository.pullRequest.reviewThreads.nodes')" \
      '$a + $b')"
    pages=$((pages + 1))
    has="$(printf '%s' "$page" \
      | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')"
    [[ "$has" != "true" ]] && break
    if [[ "$pages" -ge "$COLLECT_THREADS_MAX_PAGES" ]]; then
      printf '%s' "$all"
      return 2
    fi
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
#
# $since is normalized (iso8601_to_utc_z) and the comparison is NUMERIC
# (fromdateiso8601), not lexicographic. Lexicographic `>` on ISO 8601 only
# sorts correctly when both sides share the exact same format; a raw git
# offset ("...-07:00") compared against GitHub's "...Z" sorts on the raw
# digit at the point they diverge, not on chronological order — a review
# made HOURS BEFORE a west-of-UTC push could read as after it.
#
# `. as $acc` before the value expression is required, not stylistic: `|`
# rebinds `.` for the REST of the expression it starts, including anything
# after `//`. Without capturing the accumulator first, `.[$r.user.login]` in
# the else-branch below would index whatever `($r.body // "") | capture(...)`
# left `.` pointing at (the review BODY STRING) instead of the accumulator —
# "Cannot index string with string" — the moment a review is genuinely
# older than $since and the else-branch actually runs (every existing
# fixture's reviews postdate $since, so this went unexercised until a test
# with a genuinely-earlier review caught it).
reviewed_head_map() {
  local reviews="$1" since="$2" since_z
  since_z="$(iso8601_to_utc_z "$since")"
  printf '%s' "$reviews" | jq --arg since "$since_z" '
    (try ($since | fromdateiso8601) catch 0) as $since_epoch
    | reduce (.[] | select(.user.login | endswith("[bot]"))) as $r ({};
        . as $acc
        | . + {
            ($r.user.login):
              (($r.body // "") | capture("\\*\\*Reviewed commit:\\*\\* `(?<sha>[0-9a-f]+)`").sha
               // (if ($r.submitted_at | fromdateiso8601) > $since_epoch
                   then "timestamp" else $acc[$r.user.login] end))
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

# Findings with no decided verdict in the DECISIONS document (skill-owned —
# see decisions_read — never this script's own state).
#
# Suppression covers EVERY decided verdict, not just rejections. A bot
# re-flagging something already fixed is at least as common as one re-flagging
# something rejected, and re-triaging it burns a whole round to reach the same
# answer. This is what stops the fix -> re-review -> re-post cycle.
#
# Escalated findings are ALSO excluded: they have no verdict (that's the
# point — a human has to look), but re-dispatching a triager for the same
# escalated finding every round is exactly as wasteful as re-triaging a
# decided one.
unseen_findings() {
  jq -n --argjson f "$1" --argjson d "$2" \
    '[$f[] | select((($d.seen // {})[.fingerprint] // null) == null)
           | select(.fingerprint as $fp
                     | (($d.escalated // []) | map(.fingerprint) | index($fp)) == null)]'
}

# Reads THIS script's OWN map. Repost counts cannot live in the skill's
# `.seen` — only one component may write a given file — so the watcher keeps
# its own `repostCounts` map in state instead.
repost_count() {
  printf '%s' "$2" | jq -r --arg fp "$1" '(.repostCounts // {})[$fp].count // 0'
}

# The next repostCounts map: given the CURRENT one, this poll's full findings
# (not just fresh ones — a decided finding must still be seen to detect a
# repost), and the skill's decisions document.
#
# Grouped by fingerprint and compared against the ACCUMULATOR, not a frozen
# snapshot of decisions/state. Comparing each finding individually against a
# snapshot breaks the moment two threads share one fingerprint — routine,
# since fingerprints deliberately ignore line numbers — because whichever
# thread isn't the one currently on record always looks "new", so the
# counter ticks on EVERY poll, alternating which thread "wins". Grouping
# means a tick fires only once the ORIGINALLY DECIDED thread id is no longer
# among the currently open threads for that fingerprint (an actual close +
# repost), and the result then stays stable no matter how many threads
# coexist under it.
advance_repost_counts() {
  local state="$1" findings="$2" decisions="$3"
  jq -n --argjson s "$state" --argjson f "$findings" --argjson d "$decisions" '
    ($s.repostCounts // {}) as $counts
    | reduce ($f | group_by(.fingerprint)[]
              | select((($d.seen // {})[.[0].fingerprint]) != null)) as $g
        ($counts;
          ($g[0].fingerprint) as $fp
          | (.[$fp].threadId // $d.seen[$fp].threadId) as $current
          | if ([$g[].threadId] | index($current)) then .
            else .[$fp] = {
                   count: ((.[$fp].count // 0) + 1),
                   threadId: ($g[0].threadId)
                 }
            end)'
}

# The bots this poll expects a review from, suffixed to match `.reviewedHead`
# keys (REST's `user.login` carries "[bot]"; REVIEW_BOT_LOGINS deliberately
# does not, matching BOT_LOGINS's convention). Written to state every poll so
# the skill can tell "a bot that never ran" (missing key here too — nothing
# to wait on) from "a bot this repo doesn't use" (BOT_LOGINS lives only in
# this script, so the skill has no other way to know the difference).
expected_bots() {
  local copilot_expected="$1" bot out="[]"
  for bot in $REVIEW_BOT_LOGINS; do
    if [[ "$bot" == "copilot-pull-request-reviewer" && "$copilot_expected" != "true" ]]; then
      continue
    fi
    out="$(jq -c -n --argjson a "$out" --arg b "${bot}[bot]" '$a + [$b]')"
  done
  printf '%s' "$out"
}

# The four SKILL.md §Quiescence conditions, computed from state + decisions
# exactly as documented there (this script already reads decisions_read, so
# it can reproduce them without the skill re-deriving anything):
#
#  1. every expected bot caught up to headSha — a reviewedHead value that is
#     "timestamp" (CodeRabbit/Copilot's post-push fallback) or a hex prefix
#     of headSha (Codex's own marker) counts as caught up. Waived once
#     headShaFirstSeenAt is >= 20 minutes old: a hung or rate-limited bot
#     must not suppress quiescence forever (§6.7's stale-bot fallback).
#  2. zero unresolved bot threads: no undecided pending bot finding, every
#     decided finding's `.seen[fp].replied` is true, and no open re-post
#     (state.reposted, populated by C1 above — a decided finding invisible
#     to `.pending` by construction is still an open, unanswered thread).
#  3. every out-of-diff finding has a matching decisions.addressedOutOfDiff
#     key.
#  4. checks are neither red nor pending.
#
# Escalated findings and human threads are deliberately absent from every
# condition here — SKILL.md is explicit that they are reported, not
# resolved, and must never block quiescence.
compute_quiescent() {
  local state="$1" checks="$2" fresh="$3" ood="$4" decisions="$5" now="$6"
  jq -n --argjson s "$state" --argjson c "$checks" --argjson f "$fresh" \
        --argjson o "$ood" --argjson d "$decisions" --arg now "$now" '
    def caught_up($v; $sha):
      $v != null and ($v == "timestamp" or ($sha | startswith($v)));
    (
      ( ($s.expectedBots // []) as $bots
        | ($s.reviewedHead // {}) as $rh
        | ($s.headSha // "") as $sha
        | all($bots[]; caught_up($rh[.]; $sha))
      )
      or
      ( ($s.headShaFirstSeenAt // null) as $t
        | $t != null
          and ((($now | fromdateiso8601) - ($t | fromdateiso8601)) >= 1200)
      )
    )
    and ([$f[] | select(.kind == "bot")] | length == 0)
    and ([($d.seen // {}) | to_entries[] | select(.value.replied != true)] | length == 0)
    and (($s.reposted // []) | length == 0)
    and ([$o[] | select((($d.addressedOutOfDiff // {})[(.reviewId|tostring)]) != true)]
         | length == 0)
    and ($c.red == 0 and $c.pending == 0)
  '
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

# Kill $1 and every descendant of it, not just $1 itself. A plain
# `kill "$pid"` only reaches the direct child — any subprocess IT forked
# (git spawns a transport helper like git-remote-https, or ssh, for the
# actual network I/O) survives as an untracked orphan that keeps running
# after run_with_timeout has already "returned". Verified empirically: a
# fake `git fetch` that forked a hung child left that child alive well
# after a plain single-PID kill claimed success — see task-5-report.md for
# the before/after transcripts. macOS has no `setsid`, and giving the
# backgrounded job its own process group via `set -m` turned out to depend
# on how many process layers sit between run_with_timeout and the actual
# hang (verified NOT reliable across that variation) — so this walks the
# process tree explicitly with `pgrep -P` instead of trusting group
# semantics.
kill_tree() {
  local pid="$1" sig="${2:-TERM}" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done
  kill "-$sig" "$pid" 2>/dev/null
}

# Portable timeout wrapper: macOS ships no `timeout(1)` by default (GNU
# coreutils' `gtimeout` is opt-in via Homebrew), so this backgrounds the
# command and polls `kill -0` on its pid instead of assuming a `timeout`
# binary exists. Verified to actually return on a hang, not just in theory:
# `run_with_timeout 1 sleep 30` returns (killing the sleep) in ~1-2s with
# exit 124, and the whole process tree — including a fake `git fetch` that
# itself forked a hung child — is confirmed gone afterward, not just the
# direct child. See task-5-report.md for the transcripts. `wait "$pid"`
# after the loop exits normally picks up the command's real exit status on
# the non-timeout path.
run_with_timeout() {
  local secs="$1"; shift
  "$@" &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [[ "$waited" -ge "$secs" ]]; then
      kill_tree "$pid" TERM
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

GIT_FETCH_TIMEOUT_SECS="${PR_REVIEW_GIT_FETCH_TIMEOUT:-15}"

# The remote SHA, once origin/<branch> contains local HEAD. Replies must cite a
# commit that actually exists on the remote, so RESPOND waits on this.
detect_push() {
  local branch="$1" state="$2" remote last
  # GIT_TERMINAL_PROMPT=0 (exported near the top of this file) stops a
  # missing-credential prompt; this timeout is defense-in-depth against a
  # plain network hang (dead TCP connection, black-holed route) that has
  # nothing to do with credentials. Exit status is deliberately ignored, same
  # as before this wrapper existed — a failed/timed-out fetch just means
  # `git rev-parse origin/$branch` below reflects whatever the last
  # successful fetch left behind, not a hard error.
  run_with_timeout "$GIT_FETCH_TIMEOUT_SECS" git fetch origin "$branch" --quiet 2>/dev/null
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
  local pr="$1" state state_before decisions findings fresh reviews issues ood checks sha
  local pushed pushed_at e reviews_ok issues_ok collect_threads_rc
  local -a events=()

  state="$(state_read "$pr")" || {
    emit_error_once "state unreadable"; return 1; }
  # Snapshot of exactly what was last persisted, BEFORE this poll mutates
  # `state` — every transition guard below (REPOST, QUIESCENT, CHECKS_CLEAR)
  # compares against this, not against `state` mid-mutation.
  state_before="$state"

  # `set -uo pipefail` makes this pipeline's status the collect_threads exit
  # code whenever shape_findings itself succeeds (verified against bash
  # 3.2.57 — pipefail surfaces the one non-zero stage even when it's not the
  # rightmost). rc 1 = outright failure, nothing usable. rc 2 = the page cap
  # fired; $findings is still a valid (if incomplete) parse of whatever
  # collect_threads managed to gather, so this poll continues rather than
  # discarding real data — see collect_threads.
  findings="$(collect_threads "$pr" | shape_findings)"
  collect_threads_rc=$?
  if [[ "$collect_threads_rc" -eq 1 ]]; then
    emit_error_once "collect_threads failed"; return 1
  elif [[ "$collect_threads_rc" -ge 2 ]]; then
    emit_error_once "collect_threads: pagination limit ($COLLECT_THREADS_MAX_PAGES pages) exceeded; returning partial results"
  fi
  decisions="$(decisions_read "$pr")"
  fresh="$(unseen_findings "$findings" "$decisions")"

  reviews_ok=1
  issues_ok=1
  reviews="$(collect_reviews "$pr")" || {
    emit_error_once "collect_reviews failed; prior payload kept"
    reviews=""; reviews_ok=0; }
  issues="$(collect_issue_comments "$pr")" || {
    emit_error_once "collect_issue_comments failed; prior payload kept"
    issues=""; issues_ok=0; }

  if [[ "$reviews_ok" -eq 1 ]]; then
    ood="$(out_of_diff_reviews "$reviews")"
  else
    # Keep whatever this script last persisted instead of blanking it.
    # `announcedOutOfDiff` is a growing union keyed off THIS value, so an
    # erased `.outOfDiff` here is never re-announced once a later poll
    # recovers — one transient `gh` failure would permanently lose it.
    ood="$(printf '%s' "$state" | jq '.outOfDiff // []')"
  fi

  sha="$(head_sha "$pr")"
  # Never green-by-default: compute_quiescent's condition #4 reads `.red`
  # and `.pending`, so a transient `gh` failure must not make a blocked PR
  # look clean. `pending: 1` keeps quiescence false until the next
  # successful collection resolves it one way or the other.
  checks="$(collect_checks "$sha")" || checks='{"red":0,"pending":1}'

  # Record when THIS head SHA was first observed — the clock
  # compute_quiescent's 20-minute silent-bot fallback reads. Only stamped on
  # an actual change, not every poll, or "how long has this bot been
  # silent" could never advance.
  if [[ "$(printf '%s' "$state" | jq -r '.headSha // ""')" != "$sha" ]]; then
    state="$(printf '%s' "$state" | jq --arg s "$sha" --arg t "$(now_utc)" \
      '.headSha = $s | .headShaFirstSeenAt = $t')"
  fi

  # Copilot quota — transition-guarded. Skipped when this poll's review
  # fetch failed: no fresh data to judge the LATEST review from, and
  # deriving a verdict off stale data risks flipping copilotExpected on a
  # fluke poll.
  if [[ "$reviews_ok" -eq 1 ]]; then
    if copilot_quota_exhausted "$reviews"; then
      if [[ "$(printf '%s' "$state" | jq -r '.copilotExpected')" == "true" ]]; then
        state="$(printf '%s' "$state" | jq '.copilotExpected = false')"
        events+=("COPILOT_QUOTA|{\"reason\":\"copilot reported a quota limit; not waiting on it\"}")
      fi
    else
      state="$(printf '%s' "$state" | jq '.copilotExpected = true')"
    fi
  fi

  # The bots this poll expects a review from — written every poll (I5) so
  # the skill can tell a silent-but-expected bot from one this repo simply
  # doesn't run, and so compute_quiescent below has something to check
  # `.reviewedHead` against.
  state="$(jq -n --argjson s "$state" \
    --argjson eb "$(expected_bots "$(printf '%s' "$state" | jq -r '.copilotExpected')")" \
    '$s + {expectedBots: $eb}')"

  # Push — guarded by lastPushedSha, which seed_push_state seeds so the first
  # poll of an already-pushed branch does not announce a push that never
  # happened.
  pushed="$(detect_push "$(printf '%s' "$state" | jq -r '.branch')" "$state")"
  if [[ -n "$pushed" ]]; then
    # Record WHEN as well as WHAT: reviewed_head_map needs a timestamp to
    # decide whether a bot's review post-dates the push, and CodeRabbit and
    # Copilot publish no reviewed-SHA marker at all.
    #
    # now_utc() — the moment THIS POLL observed the push — not the commit's
    # own committer date. CodeRabbit/Copilot have no reviewed-SHA marker and
    # rely entirely on `submitted_at > lastPushedAt`, so a straggler review
    # landing between the loop's commit and the user's `git push` would read
    # as "caught up" if stamped with the (earlier) commit date instead of
    # when the push actually became visible. Contrast seed_push_state, which
    # deliberately keeps the commit date — there the branch was pushed at
    # some unknown past time, so the commit date is the correct permissive
    # floor, not a moment being newly observed.
    pushed_at="$(now_utc)"
    state="$(printf '%s' "$state" \
      | jq --arg sha "$pushed" --arg at "$pushed_at" \
           '.lastPushedSha = $sha | .lastPushedAt = $at')"
    events+=("PUSHED|$(jq -c -n --arg sha "$pushed" '{sha:$sha}')")
  fi

  # Which SHA each bot has reviewed. Quiescence condition #1 is computed from
  # this map, so leaving it unwritten makes "have the bots caught up?"
  # permanently unanswerable — the loop could never correctly report clean.
  # Skipped on a failed review fetch: keeps the PRIOR map rather than
  # deriving one from an empty review list, which would read every bot as
  # freshly "not caught up" on a transient blip.
  if [[ "$reviews_ok" -eq 1 ]]; then
    state="$(jq -n --argjson s "$state" \
      --argjson rh "$(reviewed_head_map "$reviews" \
        "$(printf '%s' "$state" | jq -r '.lastPushedAt // "1970-01-01T00:00:00Z"')")" \
      '$s + {reviewedHead: $rh}')"
  fi

  # Findings — announce only fingerprints not already announced. `announced`
  # (in THIS script's state) is separate from `seen` (in the skill's
  # decisions): `seen` holds DECIDED verdicts, `announced` holds "the human
  # has been told", which is what stops re-notification while a finding sits
  # undecided between rounds.
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
  # finding speak again. Decided findings are suppressed by decisions' `seen`,
  # upstream, in unseen_findings.
  state="$(jq -n --argjson s "$state" --argjson f "$fresh" \
    '$s + {announced: ([$f[] | {(.fingerprint): true}] | add // {})}')"

  # A DECIDED finding re-posted by the bot under a NEW thread id. The skill's
  # three-repost escape hatch is the runaway guard that replaced the round
  # cap, and it reads this counter — without it a re-posting bot gets
  # auto-replied to forever. See advance_repost_counts for why this is
  # grouped by fingerprint rather than compared per-finding against a frozen
  # snapshot.
  state="$(jq -n --argjson s "$state" \
    --argjson rc "$(advance_repost_counts "$state" "$findings" "$decisions")" \
    '$s + {repostCounts: $rc}')"

  # A decided finding now living on a DIFFERENT, still-open thread. It is
  # invisible to `.pending` by construction — unseen_findings filters by
  # fingerprint alone, so the new thread never appears there — so without
  # this it is never answered and never counted (C1): a bot closes a thread
  # and re-posts, quiescence reads `replied: true` off the OLD decision and
  # reports "0 open bot threads" while the new thread sits open forever.
  #
  # Compared against `$findings` (this poll's FULL set, not just `$fresh`) —
  # a decided finding must still be seen to detect that it moved threads —
  # and read for compute_quiescent's condition #2, above `advance_repost_counts`'s
  # notion of a "genuine" repost: two open threads sharing a fingerprint,
  # one decided, is already an unanswered thread even before the decided one
  # closes, so this deliberately fires on that coexistence too, not only
  # once repostCounts ticks.
  local reposted
  reposted="$(jq -n --argjson f "$findings" --argjson d "$decisions" --argjson s "$state" '
    [$f[] | . as $x | ($d.seen // {})[$x.fingerprint] as $prior
     | select($prior != null) | select($prior.threadId != $x.threadId)
     | {fingerprint: $x.fingerprint, threadId: $x.threadId,
        priorThreadId: $prior.threadId, priorVerdict: $prior.verdict,
        count: (($s.repostCounts // {})[$x.fingerprint].count // 0)}]')"
  state="$(jq -n --argjson s "$state" --argjson r "$reposted" '$s + {reposted: $r}')"
  if printf '%s' "$reposted" | jq -e 'length > 0' >/dev/null \
     && [[ "$(printf '%s' "$reposted" | jq -cS '.')" \
        != "$(printf '%s' "$state_before" | jq -cS '.reposted // []')" ]]; then
    events+=("REPOST|$(printf '%s' "$reposted" | jq -c '{count: length}')")
  fi

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
  # Skipped entirely on a failed issue-comments fetch (I2): `.humanComments`
  # and `.doctor` keep their PRIOR values instead of being blanked to `[]`.
  # `announcedComments` is a growing union keyed off THOSE values, so an
  # erased payload is never re-announced once a later poll recovers — one
  # transient `gh` failure would permanently lose React Doctor's findings.
  if [[ "$issues_ok" -eq 1 ]]; then
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
    # silence every later one — including newly-introduced errors, which is
    # the only part of its output that fails a PR.
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
    # finding can, and the doctor key already carries its content version —
    # so there is nothing here for a rebuild-each-poll to recover, and a
    # union avoids re-announcing a comment that is simply still there.
    state="$(jq -n --argjson s "$state" --argjson h "$allhumanc" --argjson d "$alldoctor" \
      --argjson nh "$newhumanc" --argjson nd "$newdoctor" '
      $s + {humanComments: $h, doctor: $d,
            announcedComments: (($s.announcedComments // {})
              + ([$nh[] | {(.id|tostring): true}] | add // {})
              + ([$nd[] | {((.id|tostring) + ":" + (.updatedAt // "")): true}] | add // {}))}')"
  fi

  # Checks — emit only when `.red` itself changes, not the whole
  # {red,pending} tuple. `.pending` legitimately counts down on its own
  # (5->4->3->0) while a single failing check stays failing throughout —
  # comparing the full tuple read each of those as a distinct transition,
  # measured at 4 identical notifications for one unchanged failure during
  # an ordinary CI run. `$state` still holds the PRE-POLL `.checks` here:
  # nothing above this line writes it (the write is further down), matching
  # CHECKS_CLEAR's use of `$state_before.checks.red` just below.
  if [[ "$(printf '%s' "$checks" | jq -r '.red')" \
     != "$(printf '%s' "$state" | jq -r '.checks.red // 0')" ]] \
     && printf '%s' "$checks" | jq -e '.red > 0' >/dev/null; then
    events+=("CHECKS_RED|$(printf '%s' "$checks" | jq -c '.')")
  fi

  # CHECKS_CLEAR — emit once when checks stop being red, comparing against
  # the PRE-POLL snapshot so a checks payload this poll already rewrote (via
  # a prior CHECKS_RED transition, above) cannot mask itself. On the
  # dominant path (push -> CI pending -> ... -> green) this and QUIESCENT,
  # below, are the ONLY events the watcher emits again — without them the
  # loop goes silent exactly when checks resolve.
  if printf '%s' "$checks" | jq -e \
       --argjson prev "$(printf '%s' "$state_before" | jq '.checks.red // 0')" \
       '.red == 0 and $prev > 0' >/dev/null; then
    events+=("CHECKS_CLEAR|$(printf '%s' "$checks" | jq -c '.')")
  fi

  # QUIESCENT — the four SKILL.md §Quiescence conditions, transition-guarded
  # against the PRE-POLL snapshot. A QUIESCENT emitted every poll would get
  # this Monitor auto-killed for excessive output, so `.quiescent` is
  # persisted below and compared, not recomputed from nothing each time.
  local quiescent_now was_quiescent
  quiescent_now="$(compute_quiescent "$state" "$checks" "$fresh" "$ood" "$decisions" "$(now_utc)")"
  was_quiescent="$(printf '%s' "$state_before" | jq -r '.quiescent // false')"
  if [[ "$quiescent_now" == "true" && "$was_quiescent" != "true" ]]; then
    events+=("QUIESCENT|$(jq -c -n --arg sha "$sha" '{headSha: $sha}')")
  fi

  state="$(jq -n --argjson s "$state" --argjson f "$fresh" --argjson o "$ood" \
    --argjson c "$checks" --arg sha "$sha" --argjson q "$quiescent_now" \
    '$s + {pending: $f, outOfDiff: $o, checks: $c, headSha: $sha, quiescent: $q}')"

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

# The remote-tracking ref for a branch, or empty if it doesn't exist yet (the
# branch hasn't been pushed). Isolated into its own function, matching
# detect_push/collect_checks, so tests can substitute it as a seam instead of
# touching real git refs.
resolve_remote_ref() {
  # --verify --quiet is required: a bare `git rev-parse origin/<branch>`
  # ECHOES ITS UNRESOLVED ARGUMENT on stdout when the ref is missing (the
  # normal case for a branch not yet pushed), so callers would receive the
  # literal string "origin/<branch>" instead of emptiness.
  git rev-parse --verify --quiet "origin/$1" 2>/dev/null || true
}

# Seed lastPushedSha AND lastPushedAt, once, WITHOUT emitting — main() calls
# this before the poll loop starts.
#
# At loop start the branch is normally already pushed. Leaving lastPushedSha
# null makes the FIRST poll announce a PUSHED that never happened, which
# would drive the reply step to post "Fixed in <sha>" before any fix exists.
# Leaving lastPushedAt unseeded is worse and silent: `$since` then falls back
# to the 1970 epoch default in poll_once, so on the DOMINANT path — branch
# already pushed when the loop is armed — every bot review reads as "after"
# the push. Quiescence condition #1 then passes vacuously: a false clean by
# default, not an edge case.
seed_push_state() {
  local pr="$1" branch="$2" seed seed_at
  [[ "$(state_read "$pr" | jq -r '.lastPushedSha')" != "null" ]] && return 0
  seed="$(resolve_remote_ref "$branch")"
  [[ -z "$seed" ]] && return 0
  seed_at="$(git_commit_iso_utc "$seed")"
  state_read "$pr" | jq --arg s "$seed" --arg at "$seed_at" \
    '.lastPushedSha = $s | .lastPushedAt = $at' | state_write "$pr"
}

main() {
  local pr="${1:-}" branch sha
  [[ -z "$pr" ]] && { printf 'usage: pr-review-watch.sh <pr-number>\n' >&2; exit 2; }
  branch="$(git rev-parse --abbrev-ref HEAD)"

  # A bad PR number (typo, wrong repo, closed/deleted PR) comes back from
  # GitHub as `repository.pullRequest: null` with HTTP 200 and `gh` exit 0 —
  # nothing here fails loudly. Left unchecked, head_sha's `-r` on that null
  # yields the literal string "null", the loop below polls a PR that will
  # never produce threads/reviews/checks for, and NOTHING is ever emitted:
  # a silently idling monitor indistinguishable from a quiet, healthy PR.
  # Fail loudly here instead, before a single background poll is armed.
  sha="$(head_sha "$pr")"
  if ! validate_head_sha "$sha"; then
    printf 'pr-review-watch: PR #%s has no resolvable head SHA (got %s) — check the PR number and `gh auth status`\n' \
      "$pr" "$sha" >&2
    exit 2
  fi

  state_init "$pr" "$branch"
  state_refresh_branch "$pr" "$branch"
  seed_push_state "$pr" "$branch"

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
