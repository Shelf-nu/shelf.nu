#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# Pre-commit security review via the `shelf-security-reviewer` Claude subagent.
#
# Triggered by lefthook on `pre-commit`. ADVISORY by default — prints findings
# but never fails the commit unless SHELF_SEC_REVIEW_BLOCK=1.
#
# Uses the agent's default model (Opus) for quality. On a Claude Max plan
# there is no per-token dollar cost — the script trades runtime + 5-hour
# rolling quota for higher-fidelity review. Quota is preserved by being
# *strict* about when the review actually fires (see is_relevant() below).
#
# Environment variables:
#   SHELF_SEC_REVIEW=0          Skip entirely (e.g. WIP / fixup commits).
#   SHELF_SEC_REVIEW_FORCE=1    Run regardless of filters (useful for
#                               manual sanity checks).
#   SHELF_SEC_REVIEW_BLOCK=1    Fail the commit if reviewer reports
#                               Critical or High findings.
#   SHELF_SEC_REVIEW_TIMEOUT=N  Override timeout in seconds (default 120).
#   SHELF_SEC_REVIEW_VERBOSE=1  Print which staged files passed/failed the
#                               relevance filter (for debugging triggers).
#
# Manual run (review whatever is currently staged):
#   ./scripts/security-review-staged.sh $(git diff --cached --name-only)
# ------------------------------------------------------------------------------

set -uo pipefail

# ---- 1. Opt-out -------------------------------------------------------------
if [[ "${SHELF_SEC_REVIEW:-1}" == "0" ]]; then
  exit 0
fi

# ---- 2. claude CLI must be present ------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  echo "[shelf-security-reviewer] 'claude' CLI not found — skipping (commit allowed)."
  echo "  Install Claude Code to enable: https://docs.claude.com/claude-code"
  exit 0
fi

VERBOSE="${SHELF_SEC_REVIEW_VERBOSE:-0}"
FORCE="${SHELF_SEC_REVIEW_FORCE:-0}"

# ---- 3. Smart relevance filter ----------------------------------------------
# Two-stage: hard DENY first (wins), then ALLOW. A file passes only if it
# matches an allow rule AND no deny rule. The goal is high precision —
# Opus quota only spent on genuinely security-relevant diffs.

is_denied() {
  local f="$1"
  case "$f" in
    # Tests — co-located, snapshot, mock, factory
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) return 0 ;;
    apps/webapp/test/*|apps/webapp/test/**/*) return 0 ;;
    apps/webapp/mocks/*|apps/webapp/mocks/**/*) return 0 ;;
    */__tests__/*|*/__mocks__/*|*/__snapshots__/*) return 0 ;;
    # Storybook + docs + styling + lockfiles + generated
    *.stories.ts|*.stories.tsx) return 0 ;;
    *.md|*.mdx|*.txt) return 0 ;;
    *.css|*.scss|*.less) return 0 ;;
    pnpm-lock.yaml|package-lock.json|yarn.lock) return 0 ;;
    *.generated.ts|*.generated.tsx) return 0 ;;
    # Dev-only server tooling (e.g. local SSR helpers, not in prod)
    apps/webapp/server/dev/*|apps/webapp/server/dev/**/*) return 0 ;;
    # Docs site
    apps/docs/*|apps/docs/**/*) return 0 ;;
    # Build / config / tooling
    *.config.ts|*.config.js|*.config.mjs|*.config.cjs) return 0 ;;
    tsconfig*.json|.eslintrc*|.prettierrc*|.prettierignore|.gitignore) return 0 ;;
    turbo.json|pnpm-workspace.yaml|lefthook.yml|commitlint.config.*) return 0 ;;
    # Lottie / assets / icons
    *.json) [[ "$f" == */lottie/* ]] && return 0 ;;
  esac
  return 1
}

is_allowed() {
  local f="$1"
  case "$f" in
    # Routes — every loader/action is an auth surface
    apps/webapp/app/routes/*|apps/webapp/app/routes/**/*) return 0 ;;
    # Server modules (.server.ts is the Remix convention for server-only)
    apps/webapp/app/modules/*.server.ts) return 0 ;;
    apps/webapp/app/modules/**/*.server.ts) return 0 ;;
    # Auth module — anything in it, including non-.server files
    apps/webapp/app/modules/auth/*|apps/webapp/app/modules/auth/**/*) return 0 ;;
    # Server utils
    apps/webapp/app/utils/*.server.ts) return 0 ;;
    apps/webapp/app/utils/**/*.server.ts) return 0 ;;
    # Auth/permission/role helpers (non-.server)
    apps/webapp/app/utils/auth.ts) return 0 ;;
    apps/webapp/app/utils/roles.ts) return 0 ;;
    apps/webapp/app/utils/permissions/*|apps/webapp/app/utils/permissions/**/*) return 0 ;;
    # DB client + Supabase wiring
    apps/webapp/app/database/*.server.ts) return 0 ;;
    apps/webapp/app/integrations/supabase/*) return 0 ;;
    apps/webapp/app/integrations/supabase/**/*) return 0 ;;
    # Hono server entry + middleware
    apps/webapp/server/*.ts) return 0 ;;
    # SSR entry + root auth gate
    apps/webapp/app/entry.server.tsx) return 0 ;;
    apps/webapp/app/root.tsx) return 0 ;;
    # Prisma schema + migrations + db package source
    packages/database/prisma/schema.prisma) return 0 ;;
    packages/database/prisma/migrations/*|packages/database/prisma/migrations/**/*) return 0 ;;
    packages/database/src/*|packages/database/src/**/*) return 0 ;;
    # package.json — gated separately (must add a new dep, not bump a version)
    package.json|apps/*/package.json|packages/*/package.json) return 0 ;;
  esac
  return 1
}

# package.json should only trigger review when a NEW dependency line was added
# (not a version bump or a removal). Detects added lines of the form:
#   +    "some-pkg": "1.2.3",
# while ignoring removed (-) lines and pure version-bump changes.
package_json_added_dep() {
  local f="$1"
  # Look at the staged diff for that file. New-dep lines start with '+' followed
  # by whitespace and a quoted key/value pair. Version bumps appear as a
  # paired - / + on the same key, so we filter to keys whose '+' line has no
  # matching '-' line in the same hunk.
  local diff_out
  diff_out=$(git diff --cached --no-color -- "$f" 2>/dev/null) || return 1
  # Extract package names from added lines
  local added removed
  added=$(echo "$diff_out" | grep -E '^\+[[:space:]]+"[^"]+":' | sed -E 's/^\+[[:space:]]+"([^"]+)":.*$/\1/' | sort -u)
  removed=$(echo "$diff_out" | grep -E '^-[[:space:]]+"[^"]+":' | sed -E 's/^-[[:space:]]+"([^"]+)":.*$/\1/' | sort -u)
  # Truly new packages = added but not removed
  if [[ -z "$added" ]]; then return 1; fi
  local net_new
  net_new=$(comm -23 <(echo "$added") <(echo "$removed"))
  [[ -n "$net_new" ]]
}

# Filter the staged-files argv into RELEVANT[]
RELEVANT=()
DROPPED=()
for f in "$@"; do
  if is_denied "$f"; then
    DROPPED+=("$f (denied)")
    continue
  fi
  if ! is_allowed "$f"; then
    DROPPED+=("$f (not in allow-list)")
    continue
  fi
  # Special case: package.json — only if a real new dep was added
  case "$f" in
    package.json|apps/*/package.json|packages/*/package.json)
      if ! package_json_added_dep "$f"; then
        DROPPED+=("$f (version bump only, no new dep)")
        continue
      fi
      ;;
  esac
  RELEVANT+=("$f")
done

if [[ "$VERBOSE" == "1" ]]; then
  echo "[shelf-security-reviewer] filter trace:"
  for f in "${RELEVANT[@]}"; do echo "  ✓ $f"; done
  for f in "${DROPPED[@]}"; do echo "  · $f"; done
fi

# Force override — run even if nothing matched
if [[ "$FORCE" == "1" && ${#RELEVANT[@]} -eq 0 ]]; then
  RELEVANT=("$@")
fi

if [[ ${#RELEVANT[@]} -eq 0 ]]; then
  exit 0
fi

# ---- 4. Whitespace-only diff → skip -----------------------------------------
# If the entire staged diff (across relevant files) is whitespace/formatting,
# there's no security signal worth burning Opus quota on.
if [[ "$FORCE" != "1" ]]; then
  real_changes=$(git diff --cached -w --shortstat -- "${RELEVANT[@]}" 2>/dev/null)
  if [[ -z "$real_changes" ]]; then
    [[ "$VERBOSE" == "1" ]] && echo "[shelf-security-reviewer] whitespace-only diff — skipping."
    exit 0
  fi
fi

TIMEOUT="${SHELF_SEC_REVIEW_TIMEOUT:-120}"

echo ""
echo "🔍 Shelf security review (Opus, advisory, ${#RELEVANT[@]} sensitive file(s))"
echo "   Skip:  SHELF_SEC_REVIEW=0 git commit ..."
echo "   Block: SHELF_SEC_REVIEW_BLOCK=1 git commit ..."
echo "   Debug: SHELF_SEC_REVIEW_VERBOSE=1 git commit ..."
echo ""

# ---- 5. Invoke the subagent in headless mode --------------------------------
# Why bypassPermissions: the agent's frontmatter restricts it to
# `Read, Bash, Skill, Agent, WebFetch, WebSearch` — no Edit/Write possible.
# Headless mode cannot answer permission prompts, so we accept-all within
# that already-narrowed tool set.
#
# Model: inherited from the agent definition (Opus). No --model override
# here — manual `claude --agent shelf-security-reviewer ...` and this hook
# both run on the same model for consistent review quality.
PROMPT=$(cat <<EOF
Review the currently staged diff in this repository. Get it by running:
\`git diff --cached --no-color\`

The pre-filter already narrowed the staged file set to security-relevant
paths. Focus your full checklist (Shelf-specific patterns + the mandatory
skills) on these files. Output ONLY the markdown report — no preamble, no
acknowledgment of these instructions.

If, on inspection, the actual hunks contain no security-relevant changes
(only cosmetic refactors, type-only edits, log message tweaks, dead-code
removal), respond with the single line:
NO_SECURITY_RELEVANT_CHANGES
EOF
)

set +e
OUTPUT=$(timeout "${TIMEOUT}s" claude \
  --print \
  --agent shelf-security-reviewer \
  --permission-mode bypassPermissions \
  "$PROMPT" 2>&1)
EXIT_CODE=$?
set -e

# ---- 6. Non-fatal failure modes — never block on infra issues ---------------
if [[ $EXIT_CODE -eq 124 ]]; then
  echo "[shelf-security-reviewer] timed out after ${TIMEOUT}s — skipping (commit allowed)."
  echo "  Bump with: SHELF_SEC_REVIEW_TIMEOUT=240 git commit ..."
  exit 0
fi

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "[shelf-security-reviewer] claude exited $EXIT_CODE — skipping (commit allowed)."
  echo "$OUTPUT" | tail -20
  exit 0
fi

# Strip ANSI escapes that headless mode occasionally still emits
OUTPUT_CLEAN=$(printf '%s' "$OUTPUT" | sed $'s/\x1b\\[[0-9;]*[a-zA-Z]//g')

if [[ "$OUTPUT_CLEAN" == *"NO_SECURITY_RELEVANT_CHANGES"* ]] || [[ -z "${OUTPUT_CLEAN// }" ]]; then
  exit 0
fi

echo "$OUTPUT_CLEAN"
echo ""

# ---- 7. Optional blocking mode ----------------------------------------------
if [[ "${SHELF_SEC_REVIEW_BLOCK:-0}" == "1" ]]; then
  if echo "$OUTPUT_CLEAN" | grep -qE "Critical|🟠 High|Verdict.*Block|Verdict.*Request changes"; then
    echo ""
    echo "❌ [shelf-security-reviewer] blocking commit — findings above."
    echo "   Emergency bypass:  git commit --no-verify"
    echo "   Disable blocking:  unset SHELF_SEC_REVIEW_BLOCK"
    exit 1
  fi
fi

exit 0
