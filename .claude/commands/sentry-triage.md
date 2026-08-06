---
description: Nightly Sentry triage — classify the board, propose or open tested fixes, and print the morning digest. Report-only unless you pass "active".
argument-hint: "[active]"
---

Use the `sentry-triage` agent to triage the current Sentry board for the Shelf
webapp (org `shelf-asset-management`, project `shelf-webapp`).

Run in **$ARGUMENTS** mode (empty = **report-only**):

- **report-only** (default): change nothing on the remote — only classify,
  propose fixes (with diffs), and say what you _would_ resolve.
- **active**: resolve the safe classes in Sentry with reasons, and dispatch
  `sentry-issue-fixer` agents to open **draft** PRs for auto-fixable bugs.

Return the morning digest: 🔧 draft PRs / proposed diffs · ⚠️ flagged (needs a
human) · ✅ resolved or would-resolve · 🐢 backlog.
