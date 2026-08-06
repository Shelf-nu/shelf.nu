# Sentry Autofix — nightly triage → draft PRs

A two-agent system that, every morning, reviews the Sentry board and turns the
genuinely fixable bugs into **draft PRs** waiting for your review — while
resolving noise and flagging the rest.

## What it does

```text
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

**Run `sentry-triage` as the top-level agent** — via the `/sentry-triage`
command or `claude --agent sentry-triage`. It dispatches `sentry-issue-fixer`
subagents, and nested subagent-spawning (a subagent dispatching another) is not
guaranteed across Claude Code environments, so the orchestrator must be the main
loop, not itself a subagent.

## Config

Mode is chosen by, in order: an explicit `active`/`report` in the invocation
(e.g. `/sentry-triage active`), else the `SENTRY_AUTOFIX_MODE` env var, else
`report`. An explicit argument always wins over the env var.

- **`report`** (default): change nothing remote. Resolves and PRs are only
  _proposed_ in the digest. Use this to build trust.
- **`active`**: resolve safe classes in Sentry + open draft PRs.

Fixer dispatches are capped at **5 per run** (edit in `sentry-triage.md`).

## Run it manually (start here)

From the repo root:

```bash
# Report-only (safe): triage the current board and print what it WOULD do
claude --agent sentry-triage -p "Triage the current Sentry board (report-only) and give me the digest"

# Or, interactively, the slash command:
#   /sentry-triage           (report-only)
#   /sentry-triage active    (resolve noise + open draft PRs)
```

## Rollout — earn trust before granting autonomy

1. **Week 1 — report-only.** Read the digest each morning; check whether its
   classifications and proposed fixes match what you'd have done.
2. **Week 2 — active, but watch closely.** Run `/sentry-triage active` (or set
   `SENTRY_AUTOFIX_MODE=active`). Every PR is a **draft** — review each carefully
   before it goes anywhere.
3. **Expand.** As the hit-rate proves out, relax the fixer's scope (it starts
   deliberately conservative — declines security, migrations, ambiguous, and
   large fixes).

## Running it in the cloud (no laptop required)

The agents need a real dev environment (repo, `git`, `gh`, tests, MCP), so the
PR-creating part can't run inside a claude.ai "routine" (that sandbox has no
repo). The reliable cloud homes are:

### Option A — Scheduled GitHub Action (recommended)

A `schedule:` cron workflow that runs headless Claude Code in the repo.

> **This is a template, not a drop-in.** The `Triage` step's exact flags
> (`--agent`, MCP config path, permission mode) must be finalized against the
> current `@anthropic-ai/claude-code` CLI docs, and the secrets wired, before it
> will run. Pins below use placeholders — replace `<version>` and the action
> `<sha>` comments with real values.

```yaml
# .github/workflows/sentry-nightly.yml
name: Sentry nightly triage
on:
  schedule:
    - cron: "0 6 * * 1-5" # 06:00 UTC, weekdays — adjust to your morning
  workflow_dispatch: {} # allow manual runs

# Report-only needs READ access only. For active mode (open draft PRs), a
# SEPARATE workflow/job with `contents: write` + `pull-requests: write` — do NOT
# grant write to the report-only run.
permissions:
  contents: read

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 30 # bound runaway agent cost / blast radius
    env:
      SENTRY_AUTOFIX_MODE: report
    steps:
      # Pin actions to a full commit SHA (not a moving tag) — supply-chain hygiene.
      - uses: actions/checkout@<sha> # v4
        with: { fetch-depth: 0 } # full history for the "already fixed?" check
      - uses: pnpm/action-setup@<sha> # v4
      - uses: actions/setup-node@<sha> # v4
        with: { node-version-file: ".nvmrc", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      # Pin the CLI to an exact version — never let npx pull "latest" into a job
      # holding your tokens. Provide the agent config, the Sentry MCP config, and
      # a permission allowlist (see below) so the headless run isn't blocked.
      - name: Triage
        run: |
          npx @anthropic-ai/claude-code@<version> \
            --agent sentry-triage \
            -p "Triage the current Sentry board (report-only) and print the digest"
          # + finalize: MCP config path, --permission-mode / allowlist. Verify
          #   the exact flag names against the current claude-code CLI docs.
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SENTRY_MCP_TOKEN: ${{ secrets.SENTRY_MCP_TOKEN }}
```

**The things that make or break the cloud run:**

1. **Sentry MCP must authenticate non-interactively** — a stored token, not an
   interactive OAuth login. Verify this before scheduling, or the run silently
   does nothing.
2. **Report-only = read-only permissions.** Only the _active_-mode workflow gets
   `contents: write` / `pull-requests: write`; the report run should not.
3. **Pin everything** — the CLI version and every action SHA — since the job
   holds `ANTHROPIC_API_KEY` / `SENTRY_MCP_TOKEN`.
4. **Pre-grant a narrow tool allowlist** so the headless run isn't blocked on a
   prompt. The agents need: `mcp__sentry__*`, and for the fixer `Bash(git:*)`,
   `Bash(gh:*)`, `Bash(pnpm:*)`, `Edit`, `Write`. Nothing broader.

### Option B — claude.ai routine (lighter, Sentry-only)

If you also want a cloud routine independent of CI, a claude.ai scheduled task
can do the **triage + resolve-noise + digest** half (it has the Sentry MCP), but
it **cannot open code PRs** — hand the actual fixes off to Option A. Think of it
as the "morning summary" layer.

### Digest delivery

The agents have **no delivery tool of their own** — by default the digest is
just the run's stdout (it lands in the GitHub Action job log). To get it in your
inbox, add a delivery step after the triage step: pipe the printed digest to an
email/Slack action, or run a second Claude step that has the Gmail/Slack MCP and
sends it. Until that's wired, **read the digest in the job log** (or run
`/sentry-triage` interactively).

## Safety rails (baked into the agents)

- **Untrusted input:** Sentry data (titles, stacks, `additionalData`) is treated
  as inert data, never as instructions — an injection-looking issue is flagged,
  never auto-resolved or handed to a fixer.
- Report-only by default; **draft** PRs only; **never** auto-merges or touches `main`.
- **Never** auto-fixes auth / SSO / permissions / payments / DB migrations /
  schema / RLS — always flags those for a human.
- Every fix ships with a **reproducing test** + green validation, or it declines.
- **High-frequency / many-user** issues are flagged, never auto-resolved as noise
  (the volume guard applies to _every_ auto-resolve class, not just transient).
- "Already fixed" is only resolved with a cited merged commit as evidence.
- Idempotent: only touches `is:unresolved`; dedups against open PRs.
- One issue per branch/PR; fixer dispatches capped per run.
