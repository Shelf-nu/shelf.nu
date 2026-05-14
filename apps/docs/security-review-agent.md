# Security Review Agent

Shelf ships with a Claude-powered security reviewer that runs automatically
on `git commit` against security-sensitive diffs. It catches the regressions
the team has hit most often — cross-org IDORs, missing `requirePermission`
gates, open redirects, missing Zod validation, audit-trail gaps — before the
code reaches review.

The reviewer is read-only: it inspects the staged diff, prints a markdown
report, and (by default) lets the commit proceed. It does not edit code.

## Components

| File                                              | Role                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/shelf-security-reviewer.md`       | The subagent definition — Shelf-specific auth patterns, the IDOR history, and the conditional skill activations. Runs on Opus.                            |
| `scripts/security-review-staged.sh`               | The pre-commit wrapper — filters staged files to security-sensitive paths, invokes the agent headlessly, prints the report, optionally blocks the commit. |
| `lefthook.yml` → `pre-commit` → `security-review` | Wires the script into the existing pre-commit chain at priority 5 (after typecheck). Inherits `skip: [merge, rebase]` from the rest of the pipeline.      |

The agent is also usable on demand — see [Manual invocation](#manual-invocation).

## Requirements

- The Claude Code CLI must be installed and authenticated. Without it, the
  hook prints a one-line notice and skips (commits are never blocked by a
  missing CLI). Install via [docs.claude.com/claude-code](https://docs.claude.com/claude-code).
- A Claude subscription (Pro / Max) or an API key — whichever your local
  `claude` is logged in with. On a subscription, there is no per-token dollar
  cost; the hook consumes from your 5-hour rolling quota instead.

## When the hook fires

A two-stage allow/deny filter decides whether the reviewer runs at all on a
given commit. The goal is high precision — Opus quota only spent on diffs
that can realistically introduce security regressions.

### Triggers (allow)

A staged file triggers a review if it matches one of these paths:

- `apps/webapp/app/routes/**` — every loader/action is an auth surface
- `apps/webapp/app/modules/**/*.server.ts` — services
- `apps/webapp/app/modules/auth/**` — anything in the auth module
- `apps/webapp/app/utils/{auth,roles,cookies.server,booking-authorization.server}.ts`
- `apps/webapp/app/utils/**/*.server.ts`
- `apps/webapp/app/utils/permissions/**`
- `apps/webapp/app/database/*.server.ts`
- `apps/webapp/app/integrations/supabase/**`
- `apps/webapp/server/*.ts` (Hono middleware, session, rate-limit)
- `apps/webapp/app/entry.server.tsx`
- `apps/webapp/app/root.tsx`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/**/*.sql`
- `packages/database/src/**`
- `package.json` — **only when a net-new dependency is added**, not on
  version bumps. Catches supply-chain risk without firing on every Renovate
  PR.

### Skipped (deny — wins over allow)

The reviewer is **never** invoked for these, even if they live inside a
sensitive directory:

- Tests: `*.test.{ts,tsx}`, `*.spec.{ts,tsx}`, `apps/webapp/test/**`,
  `apps/webapp/mocks/**`, `**/__tests__/**`, `**/__mocks__/**`,
  `**/__snapshots__/**`
- Storybook: `*.stories.{ts,tsx}`
- Docs / text: `*.md`, `*.mdx`, `*.txt`
- Styles: `*.css`, `*.scss`, `*.less`
- Lockfiles: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
- Generated: `*.generated.{ts,tsx}`
- Configs: `*.config.{ts,js,mjs,cjs}`, `tsconfig*.json`, `.eslintrc*`,
  `.prettierrc*`, `turbo.json`, `pnpm-workspace.yaml`, `lefthook.yml`,
  `commitlint.config.*`
- Dev-only server tooling: `apps/webapp/server/dev/**`
- The docs site: `apps/docs/**`
- Lottie JSON

### Additional smart checks

- **Whitespace-only diff** → skip. Reformatting can't introduce vulns.
- **`package.json` version bumps** → skip. Only fires when a key is added
  that wasn't present before (parsed from the staged diff itself).
- **Pure deletions** are **not** skipped. Removing a `requirePermission()`
  call is exactly the kind of regression we want to catch.

## What the agent checks

The agent operates against a Shelf-specific checklist baked into
`.claude/agents/shelf-security-reviewer.md`. High-impact items:

- **Cross-org IDOR** — missing `organizationId` filters on `findUnique` /
  `update` / relational `connect`, and the `connect: ids.map((id) => ({ id }))`
  anti-pattern that has shipped to prod multiple times (notes 2025-09-24,
  booking 2026-04-16, locations 2026-04-27).
- **`requirePermission` on mutating routes** — every mutating loader/action
  must gate through `requirePermission({ userId, request, entity, action })`
  from `~/utils/roles.server`. `requireAuthSession`-only on a write is a
  finding.
- **Zod validation + server-side error fallback** — actions must `parse` /
  `safeParse` before any DB write; components must surface server-side
  errors via `getValidationErrors`.
- **Secrets / env** — no hardcoded credentials; no leaking of
  `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE`, Stripe keys, SMTP creds, etc.
  into client bundles.
- **Supabase RLS** — new models in `schema.prisma` must ship with an RLS
  policy migration; direct-Prisma access to per-tenant data is flagged where
  RLS-enforcing Supabase access would be safer.
- **Session / cookie flags** — new `Set-Cookie` entries must set
  `httpOnly`, `secure`, and `sameSite` for auth cookies.
- **Open redirects** — unvalidated `redirectTo` from query params or form
  bodies.
- **File uploads** — MIME/magic-byte validation, size caps, filename
  sanitization, `organizationId` in the storage path.
- **Raw SQL** — `$queryRaw` / `$executeRaw` must be parameterized.
- **Audit events** — for tracked entity mutations, `recordEvent` must run
  inside the same `db.$transaction` as the mutation (see
  `.claude/rules/use-record-event.md`).
- **Dependencies** — new auth-related packages flagged for human review;
  obvious typo-squat / no-maintainer red flags called out.

The agent also conditionally activates the following skills based on the
content of the diff: `security-review` (always), `supabase` (when
Supabase/RLS/migrations touched), `oauth-oidc-misconfiguration` (when
OAuth/SSO touched), `two-factor-authentication-best-practices` (when MFA
flows touched), `supabase-postgres-best-practices` (when SQL/migrations).

## Reading the output

The agent emits a structured markdown report:

```
## Security Review: <PR or branch>

**Scope:** files changed, lines +/-
**Risk level:** Critical | High | Medium | Low | None
**Verdict:** Block | Request changes | Approve with notes | Approve

## Findings

### 🔴 Critical / P0
- **<title>** — `path/to/file.ts:42`
  <explanation>
  **Fix:** <concrete suggestion>

### 🟠 High / P1
### 🟡 Medium / P2
### 🔵 Low / nit

## Checklist coverage
| Area | Status | Notes |
| --- | --- | --- |
| Org-scoping / IDOR | ✅ / ⚠️ / ❌ / N/A | ... |

## Skills consulted
- security-review
- supabase

## What I didn't check
<honest limits — things outside the diff or outside the repo>
```

Findings cite `path/file.ts:line`. The **What I didn't check** section is
intentional — it tells you when the agent can't verify something (e.g.
production RLS policies in the Supabase dashboard, external IdP config),
so you know where additional manual review is needed.

## Environment variable controls

All flags are local to the `git commit` invocation that sets them.

| Variable                   | Default | Purpose                                                                                                            |
| -------------------------- | ------: | ------------------------------------------------------------------------------------------------------------------ |
| `SHELF_SEC_REVIEW`         |     `1` | Set to `0` to skip the hook entirely (WIP / fixup commits, urgent hotfixes).                                       |
| `SHELF_SEC_REVIEW_BLOCK`   |     `0` | Set to `1` to fail the commit when the reviewer reports Critical or High findings.                                 |
| `SHELF_SEC_REVIEW_FORCE`   |     `0` | Set to `1` to run regardless of the relevance filter — useful for manual sanity checks on otherwise-skipped files. |
| `SHELF_SEC_REVIEW_TIMEOUT` |   `120` | Timeout in seconds. Bump for very large diffs.                                                                     |
| `SHELF_SEC_REVIEW_VERBOSE` |     `0` | Set to `1` to print the trace of which staged files passed/failed the filter. Useful for tuning.                   |

Examples:

```bash
# Skip the hook for a WIP commit
SHELF_SEC_REVIEW=0 git commit -m "wip: refactor in progress"

# Block on Critical/High findings — useful when working on auth code
SHELF_SEC_REVIEW_BLOCK=1 git commit -m "feat(auth): add SSO callback"

# Debug why the hook did/didn't fire on a particular commit
SHELF_SEC_REVIEW_VERBOSE=1 git commit -m "..."
```

To make blocking your personal default, export it in your shell rc:

```bash
echo 'export SHELF_SEC_REVIEW_BLOCK=1' >> ~/.bashrc
```

To bypass **all** pre-commit hooks (not just this one) in a genuine
emergency:

```bash
git commit --no-verify -m "hotfix: prod is down"
```

## Manual invocation

The agent is also usable on demand from any Claude Code session — useful
for reviewing an entire PR or branch rather than a single staged diff:

```bash
# Review a GitHub PR
claude --agent shelf-security-reviewer "review PR #2540 for security"

# Review the current branch vs main
claude --agent shelf-security-reviewer "review the current branch"

# Review a specific commit range
claude --agent shelf-security-reviewer "review commits abc123..def456"
```

From inside an interactive Claude session, you can also delegate to the
agent without leaving the conversation:

```
> Use the shelf-security-reviewer to audit my changes on this branch
```

Description-based routing will pick up the subagent automatically.

## Cost and quota

On a Claude subscription (Pro / Max), the hook is free in dollar terms —
it draws from your 5-hour rolling quota rather than billing per token.
The smart filter keeps quota use proportionate: most commits (components,
styles, tests, docs, config) skip entirely. Only commits that genuinely
touch the auth/data-mutation surface fire the review.

Rough cost per fired review on Opus: roughly equivalent to a small
interactive turn — well within typical daily quota on Max 5×.

If you find pre-commit reviews are eating into interactive work:

1. Switch from `pre-commit:` to a new `pre-push:` block in `lefthook.yml`.
   Same coverage, runs ~10× less often.
2. Tighten the allow-list in `scripts/security-review-staged.sh` —
   for example, drop `package.json` if Renovate noise is dominant.
3. Use `SHELF_SEC_REVIEW=0` for the day during rapid iteration on
   non-security work.

## Testing the hook

To smoke-test the wiring end to end without inventing a real diff:

```bash
# Create a deliberately broken fixture
cat > apps/webapp/app/modules/asset/_security-test-fixture.server.ts <<'EOF'
import { db } from "~/database/db.server";

export async function updateAssetTagsUnsafe(params: {
  assetId: string;
  tagIds: string[];
}) {
  // BUG: no org scope, IDOR via connect.map
  await db.asset.update({
    where: { id: params.assetId },
    data: { tags: { connect: params.tagIds.map((id) => ({ id })) } },
  });
}
EOF

# Stage it and run the pre-commit pipeline without actually committing
git add apps/webapp/app/modules/asset/_security-test-fixture.server.ts
npx lefthook run pre-commit

# Clean up
git restore --staged apps/webapp/app/modules/asset/_security-test-fixture.server.ts
rm apps/webapp/app/modules/asset/_security-test-fixture.server.ts
```

The agent should flag at minimum: cross-org IDOR on `where: { id: assetId }`,
relational IDOR via `connect: tagIds.map(...)`, and missing
`requirePermission`. If you see fewer findings than that, the agent isn't
being routed correctly — check that `.claude/agents/shelf-security-reviewer.md`
exists and that `claude` is logged in.

## Troubleshooting

**"`claude` CLI not found — skipping"** — install Claude Code and run
`claude /login` once. The hook will pick up the next `git commit`.

**Hook fires but produces no report** — likely the agent returned
`NO_SECURITY_RELEVANT_CHANGES`. Run with `SHELF_SEC_REVIEW_VERBOSE=1` to
confirm which files passed the filter, and inspect the diff manually.

**Hook times out** — bump the timeout: `SHELF_SEC_REVIEW_TIMEOUT=240 git commit ...`.
Very large diffs (>2000 lines) may need 300+.

**Findings feel wrong / over-cautious** — the agent is not perfect.
The hook is advisory by default precisely so false positives don't block
work. If a finding is repeatedly wrong on a specific pattern, edit
`.claude/agents/shelf-security-reviewer.md` to add a clarifying exception
(e.g. the existing carve-out for `requirePermission` called for its
side-effect with a discarded return value).

**Hook never fires on a file I think it should** — run with
`SHELF_SEC_REVIEW_VERBOSE=1` to see the filter trace. If the path is
genuinely security-relevant but doesn't match the allow-list, add it to
`is_allowed()` in `scripts/security-review-staged.sh`.

## Customizing the agent

The Shelf-specific checklist lives in
`.claude/agents/shelf-security-reviewer.md`. Anyone with the repo can
extend it — for example, adding a new auth pattern to enforce, or a new
historical incident class to flag. Changes are picked up on the next
`git commit` with no rebuild.

The relevance filter lives in `scripts/security-review-staged.sh` in the
`is_allowed()` and `is_denied()` functions. Adding a new sensitive path
is a one-line `case` addition.
