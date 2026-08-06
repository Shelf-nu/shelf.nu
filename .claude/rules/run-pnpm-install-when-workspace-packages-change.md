---
description: A missing packages/* symlink surfaces as repeated "Failed to resolve import @shelf/<pkg>" Vite errors that look like a config bug — the real cause is a checkout installed before that package existed. Run pnpm install
globs:
  [
    "apps/webapp/vite.config.ts",
    "packages/**/package.json",
    "pnpm-workspace.yaml",
  ]
---

# `@shelf/*` Resolution Failures Mean a Stale `pnpm install`

Workspace packages are consumed through `node_modules` **symlinks** that only
`pnpm install` creates. `packages/datetime/` arriving via `git pull` or a new
branch does **not** create `apps/webapp/node_modules/@shelf/datetime`. Any
checkout installed before that package existed fails to resolve it:

```
Pre-transform error: Failed to resolve import "@shelf/datetime"
from "app/utils/date-format.ts". Does the file exist?
```

The `(client)` prefix and the repetition (`(x2)`, `(x3)`, …) make this read as
a Vite/config bug. It is not — `ssr.noExternal` and the `exports` map are
fine. **The fix is `pnpm install` from the monorepo root.** Diagnose with
`ls apps/webapp/node_modules/@shelf/` and compare against the `workspace:*`
entries in `apps/webapp/package.json`.

This bites hardest in **git worktrees**: each carries its own `node_modules`,
so a long-lived worktree silently misses every package added since it was
created. `vite.config.ts` now fails fast with a "run pnpm install" message
listing the missing packages, rather than letting the resolution errors scroll
by — keep that guard when editing the config.

When you **add** a `packages/*` workspace dependency, say so in the PR
description: everyone with an existing checkout (and every worktree) must
re-run `pnpm install` or their dev server breaks in a way that looks like your
code change.
