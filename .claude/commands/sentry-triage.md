---
description: Nightly Sentry triage — classify the board, propose or open tested fixes, and print the morning digest. Report-only unless you pass "active".
argument-hint: "[active]"
---

Run the Sentry triage for the Shelf webapp (org `shelf-asset-management`,
project `shelf-webapp`) by following the workflow in
`.claude/agents/sentry-triage.md` **yourself, in this conversation** — do not
dispatch `sentry-triage` as a subagent. Dispatch `sentry-issue-fixer` agents
directly (as first-level subagents) for auto-fixable bugs.

**Mode — report-only unless the argument is exactly `active`.** The argument is:
`$ARGUMENTS`. If it is `active`, run in **active** mode (resolve safe classes in
Sentry with reasons, and open **draft** PRs). Otherwise — including when it is
empty — run in **report-only** mode: change nothing on the remote; only
classify, propose fixes (with diffs), and say what you _would_ resolve. This
explicit mode takes precedence over any `SENTRY_AUTOFIX_MODE` environment
variable.

Return the morning digest: 🔧 draft PRs / proposed diffs · ⚠️ flagged (needs a
human) · ✅ resolved or would-resolve · 🐢 backlog.
