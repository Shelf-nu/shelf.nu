# Sentry Autofix — nightly triage → draft PRs

A two-agent system that, every morning, reviews the Sentry board and turns the
genuinely fixable bugs into **draft PRs** waiting for your review — while
resolving noise and flagging the rest.

## What it does

```
nightly run (headless Claude Code, in this repo)
  → sentry-triage  (classifies every unresolved issue)
      ├─ noise / transient / already-fixed → resolve in Sentry, with a reason
      ├─ real but NOT cleanly auto-fixable → FLAG in the digest (no change)
      └─ auto-fixable, localized, testable → dispatch a sentry-issue-fixer
                                             (isolated git worktree, 1 per issue)
  → each sentry-issue-fixer
      → investigate → failing test → minimal fix → validate
      → open a DRAFT PR (`Fixes SHELF-WEBAPP-XXX`, label `sentry-autofix`)
        OR decline with a reason
  → digest: 🔧 PRs · ⚠️ flagged (needs a human) · ✅ resolved · 🐢 backlog
```

The design principle that makes this safe: **classification before action.**
Most Sentry issues are not cleanly auto-fixable, and the agents are built to
decline (and flag) rather than open a bad PR or bury a live bug.

## The agents

| File                                   | Role                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `.claude/agents/sentry-triage.md`      | Orchestrator: classify, resolve safe classes, dispatch fixers, produce the digest.                        |
| `.claude/agents/sentry-issue-fixer.md` | Worker: one issue → draft PR **or** a reasoned decline. Never touches main/auth/migrations, never merges. |
| `.claude/commands/sentry-triage.md`    | The `/sentry-triage` command wrapper.                                                                     |

Both agents default to **report-only** and are `model: sonnet` (bump the fixer
to a stronger model for harder bug classes if you like).

## Config

`SENTRY_AUTOFIX_MODE` env var (or the `/sentry-triage active` argument), read by
both agents:

- **`report`** (default): change nothing remote. Resolves and PRs are only
  _proposed_ in the digest. Use this to build trust.
- **`active`**: resolve safe classes in Sentry + open draft PRs.

Fixer dispatches are capped at **5 per run** (edit in `sentry-triage.md`).

## Run it manually (start here)

From the repo root:

```bash
# Report-only (safe): triage the current board and print what it WOULD do
claude -p "Run the sentry-triage agent over the current Sentry board and give me the digest"

# Or, interactively, the slash command:
#   /sentry-triage           (report-only)
#   /sentry-triage active    (resolve noise + open draft PRs)
```

## Rollout — earn trust before granting autonomy

1. **Week 1 — report-only.** Read the digest each morning; check whether its
   classifications and proposed fixes match what you'd have done.
2. **Week 2 — active, but watch closely.** Flip `SENTRY_AUTOFIX_MODE=active`
   (or run `/sentry-triage active`). Every PR is a **draft** — review each
   carefully before it goes anywhere.
3. **Expand.** As the hit-rate proves out, relax the fixer's scope (it starts
   deliberately conservative — declines security, migrations, ambiguous, and
   large fixes).

## Running it in the cloud (no laptop required)

The agents need a real dev environment (repo, `git`, `gh`, tests, MCP), so the
PR-creating part can't run inside a claude.ai "routine" (that sandbox has no
repo). The reliable cloud homes are:

### Option A — Scheduled GitHub Action (recommended)

A `schedule:` cron workflow that runs headless Claude Code in the repo. Sketch
(finalize the exact `claude-code` action/CLI inputs against its current docs —
we'll do this together):

```yaml
# .github/workflows/sentry-nightly.yml  (template — needs secrets configured)
name: Sentry nightly triage
on:
  schedule:
    - cron: "0 6 * * 1-5" # 06:00 UTC, weekdays — adjust to your morning
  workflow_dispatch: {} # allow manual runs
permissions:
  contents: write # push branches
  pull-requests: write # open draft PRs
jobs:
  triage:
    runs-on: ubuntu-latest
    env:
      SENTRY_AUTOFIX_MODE: report # flip to "active" once trusted
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 } # full history for the "already fixed?" check
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: ".nvmrc", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      # Run headless Claude Code with the sentry-triage agent. Provide:
      #   ANTHROPIC_API_KEY (repo secret), the Sentry MCP config + token,
      #   and a permission allowlist so it runs unattended.
      - name: Triage
        run: |
          npx @anthropic-ai/claude-code -p \
            "Run the sentry-triage agent over the last 24h and post the digest" \
            # + flags: --agents, MCP config path, --permission-mode / allowlist
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SENTRY_MCP_TOKEN: ${{ secrets.SENTRY_MCP_TOKEN }}
```

**The two things that make or break the cloud run:**

1. **Sentry MCP must authenticate non-interactively** — a stored token, not an
   interactive OAuth login. Verify this before scheduling, or the run silently
   does nothing.
2. **Permissions must be pre-granted** so the headless run isn't blocked waiting
   on a prompt — allowlist `mcp__sentry__*`, `Bash(git:*)`, `Bash(gh:*)`,
   `Bash(pnpm:*)`, `Edit`, `Write` in the run config, and nothing broader.

### Option B — claude.ai routine (lighter, Sentry-only)

If you also want a cloud routine independent of CI, a claude.ai scheduled task
can do the **triage + resolve-noise + email-me-a-digest** half (it has the
Sentry MCP), but it **cannot open code PRs** — hand the actual fixes off to
Option A. Think of it as the "morning summary" layer.

### Digest delivery

The Gmail MCP is connected, so the nightly run can **email you the digest**
(the ⚠️ flagged section is the part you act on). Or post to Slack if you use
Claude-in-Slack.

## Safety rails (baked into the agents)

- Report-only by default; **draft** PRs only; **never** auto-merges or touches `main`.
- **Never** auto-fixes auth / SSO / permissions / payments / DB migrations /
  schema / RLS — always flags those for a human.
- Every fix ships with a **reproducing test** + green validation, or it declines.
- **High-frequency / many-user** issues are flagged, never auto-resolved as noise.
- Idempotent: only touches `is:unresolved`; dedups against open PRs.
- One issue per branch/PR; fixer dispatches capped per run.
