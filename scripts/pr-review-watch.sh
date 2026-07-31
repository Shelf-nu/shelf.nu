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
