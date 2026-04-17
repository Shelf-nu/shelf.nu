# Package Update Analysis

**Date:** 2026-04-09
**Branch:** `chore-update-packages`
**Tool used:** [taze](https://github.com/antfu-collective/taze) v19.11.0

---

## Table of Contents

- [Summary](#summary)
- [Patch & Minor Updates (Safe)](#patch--minor-updates-safe)
- [Major Updates — Tier 1: Trivial](#major-updates--tier-1-trivial)
- [Major Updates — Tier 2: Moderate](#major-updates--tier-2-moderate)
- [Major Updates — Tier 3: Significant](#major-updates--tier-3-significant)
- [Major Updates — Blocked](#major-updates--blocked)
- [Recommended Batching Strategy](#recommended-batching-strategy)
- [How to run taze](#how-to-run-taze)

---

## Summary

| Category            | Count           |
| ------------------- | --------------- |
| Patch/minor (safe)  | 21 packages     |
| Major — Trivial     | 18 packages     |
| Major — Moderate    | 8 packages      |
| Major — Significant | 6 packages      |
| Major — Blocked     | 5 packages      |
| **Total outdated**  | **58 packages** |

---

## Patch & Minor Updates (Safe)

No breaking changes. Bump versions and run `pnpm webapp:validate`.

| Package                  | Current  | Latest   | Type  | Area             |
| ------------------------ | -------- | -------- | ----- | ---------------- |
| react-router-hono-server | ^2.25.0  | ^2.25.2  | patch | server           |
| prosemirror-view         | ^1.41.6  | ^1.41.8  | patch | editor           |
| prosemirror-gapcursor    | ^1.4.0   | ^1.4.1   | patch | editor           |
| prosemirror-transform    | ^1.11.0  | ^1.12.0  | minor | editor           |
| nodemailer               | ^8.0.4   | ^8.0.5   | patch | email            |
| crisp-sdk-web            | ^1.0.27  | ^1.0.28  | patch | chat widget      |
| remix-utils              | ^9.1.0   | ^9.3.1   | minor | utils            |
| lru-cache                | ^11.2.6  | ^11.3.3  | minor | cache            |
| jotai                    | ^2.18.0  | ^2.19.1  | minor | state mgmt       |
| fuse.js                  | ^7.1.0   | ^7.3.0   | minor | search           |
| framer-motion            | ^12.35.0 | ^12.38.0 | minor | animation        |
| @supabase/supabase-js    | ^2.98.0  | ^2.103.0 | minor | auth/db          |
| @sentry/react-router     | ^10.42.0 | ^10.47.0 | minor | monitoring       |
| @bwip-js/browser         | ^4.8.0   | ^4.9.0   | minor | barcodes         |
| postcss                  | ^8.5.8   | ^8.5.9   | patch | css (dev)        |
| nodemailer-mock          | ^2.0.9   | ^2.0.10  | patch | test (dev)       |
| @typescript-eslint/\*    | ^8.56.1  | ^8.58.1  | minor | lint (dev)       |
| @playwright/test         | ^1.58.2  | ^1.59.1  | minor | e2e (dev)        |
| turbo                    | ^2.8.13  | ^2.9.5   | minor | build (root)     |
| @commitlint/\*           | ^20.4.3  | ^20.5.0  | minor | git hooks (root) |
| dotenv (database pkg)    | ^17.3.1  | ^17.4.1  | minor | env (dev)        |

---

## Major Updates — Tier 1: Trivial

Low risk, minimal code changes. Can be done quickly with a validate pass.

| Package                 | Update       | Effort  | Breaking Changes                                                                                        | Action                                                                    |
| ----------------------- | ------------ | ------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| pino + pino-pretty      | 8→10 / 10→13 | Trivial | Only drops Node 18 (we're on 22). pino-pretty replaces `readable-stream` with built-in `stream` module. | Bump and test. No code changes expected. 1 file affected.                 |
| react-dropzone          | 14→15        | Trivial | `isDragReject` now resets after drop (only reflects active drag state).                                 | Safe bump — grep confirms no `isDragReject` usage in codebase.            |
| date-fns                | 3→4          | Trivial | ESM-first. `intervalToDuration` skips 0 values. First-class time zone support replaces `date-fns-tz`.   | Bump. Good opportunity to consolidate `date-fns-tz` into core. ~15 files. |
| isbot                   | 4→5          | Trivial | Minimal. Named import syntax required (likely already used since v4).                                   | Bump and verify import style. 1-2 files.                                  |
| csv-parse               | 5→6          | Trivial | ESM-first. `relax` option renamed to `relax_quotes`. Error code renamed.                                | Check import style and option names. 1 file (`app/utils/csv.server.ts`).  |
| path-to-regexp          | 6→8          | Trivial | Wildcards must be named (`/users/*path` not `/users/*`). Optional `?` syntax replaced with braces.      | Review and update route patterns. 1 file (`server/middleware.ts`).        |
| cross-env               | 7→10         | Trivial | ESM-only. Requires Node >= 20.                                                                          | Bump. CLI tool, no code changes.                                          |
| vite-tsconfig-paths     | 4→6          | Trivial | None intentional. Internal rewrite. Requires Node >= 18, Vite >= 5.                                     | Drop-in replacement.                                                      |
| vite-plugin-cjs-interop | 2→3          | Trivial | Minimal. Vite version compatibility bump.                                                               | Bump and test build.                                                      |
| @evilmartians/lefthook  | 1→2          | Trivial | Removed deprecated `skip_output` and `exclude` regexp support. Some CLI arg names changed.              | Review `lefthook.yml` for deprecated options, then bump.                  |
| @markdoc/markdoc        | 0.4→0.5      | Trivial | Mostly additive — custom tag resolution, formatter fixes, new `orderedListMode` option.                 | Bump and test markdown rendering. ~11 files.                              |
| iconv-lite              | 0.6→0.7      | Trivial | Bug fixes around split surrogate pairs in UTF-8 encoding.                                               | Bump. No code changes. 1 file.                                            |
| @paralleldrive/cuid2    | 2→3          | Trivial | `isCuid` now requires first character to be a-z (previously could be a number). ESM conversion.         | Check if `isCuid` is used, then bump. ~5 files.                           |
| react-microsoft-clarity | 1→2          | Trivial | API changes to `clarity.init()` and related methods.                                                    | Check and update the one file (`app/components/marketing/clarity.tsx`).   |
| pigeon-maps             | 0.21→0.22    | Trivial | Minimal (still 0.x phase).                                                                              | Bump and test map rendering. 1 file.                                      |
| sharp                   | 0.33→0.34    | Trivial | Requires Node >= 20.9.0. Removed deprecated `failOnError`. AVIF uses SSIMULACRA2.                       | Safe bump — no deprecated APIs used. ~4 files.                            |
| cookie                  | 0.7→1.x      | Trivial | Case-insensitive options. `options.priority` fallback fix.                                              | Verify if directly imported or transitive (likely via React Router).      |
| MSW                     | 1→2          | Trivial | `rest.*()` → `http.*()`. `res(ctx.json())` → `HttpResponse.json()`. `req.body` → `request.json()`.      | Mechanical rewrite of 9 handlers in 2 files. MSW 1.x is long EOL.         |

---

## Major Updates — Tier 2: Moderate

Requires care, code changes, and testing. Each is individually manageable.

| Package                     | Update          | Effort   | Breaking Changes                                                                                                                                                               | Action                                                                                  |
| --------------------------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| lucide-react                | 0.462→1.x       | Moderate | Brand icons removed (must replace with alternatives). UMD build removed. `aria-hidden` set by default. Bundle: 11.4MB → 1MB.                                                   | Grep for brand icon imports across ~101 files. Standard icons unchanged.                |
| @faker-js/faker             | 8→10            | Moderate | ESM-only. Removed deprecated methods from v9. Strict length validation. TS `moduleResolution` must be `Bundler`/`Node20`/`NodeNext`.                                           | Dev dependency only. Check for removed methods in test factories.                       |
| dotenv-cli                  | 7→11            | Moderate | Variable expansion syntax changes. Interpolated vars must be declared before use.                                                                                              | Review `.env` files for interpolation patterns. Test all `db:*` scripts.                |
| qrcode-generator            | 1→2             | Moderate | Limited documentation available.                                                                                                                                               | Bump and thoroughly test QR code generation. 3 files.                                   |
| zxing-wasm + @zxing/library | 2→3 / 0.20→0.21 | Moderate | zxing-wasm: `readBarcodes()` replaces `readBarcodesFromImageFile()`/`readBarcodesFromImageData()`.                                                                             | Verify if directly imported. May be transitive only.                                    |
| TypeScript                  | 5→6             | Moderate | `esModuleInterop`/`allowSyntheticDefaultImports` always on. `types` defaults to `[]`. Import assertions deprecated.                                                            | Run `pnpm turbo typecheck` and fix. Last JS-based TS before Go rewrite in v7.           |
| Zod                         | 3→4             | Moderate | Error API reworked. `z.string().email()` → `z.email()`. `.passthrough()`/`.strict()` deprecated. Optional field defaults applied. **14x faster parsing, 2.3x smaller bundle.** | Mechanical find-and-replace across ~241 files. Old APIs work with deprecation warnings. |
| Stripe + @stripe/stripe-js  | 20→22 / 3→9     | Moderate | v21: `decimal_string` → `Stripe.Decimal` type. v22: `new Stripe()` required (ES6 class). Types moved inline.                                                                   | Grep for amount/price string handling. Update constructor. ~15-20 files.                |

---

## Major Updates — Tier 3: Significant

Each is a mini-project requiring dedicated focus and thorough testing.

| Package       | Update    | Effort      | Breaking Changes                                                                                                                                                                                                                                                                                 | Recommendation                                                                                                                                   |
| ------------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tailwind CSS  | 3→4       | Significant | Config moves from `tailwind.config.js` to CSS-first `@theme` directives. `@tailwind` → `@import "tailwindcss"`. Class renames (`bg-gradient-to-*` → `bg-linear-to-*`, etc). `border` default changes to `currentColor`. New Rust engine, 60-80% faster. `@tailwindcss/upgrade` CLI handles ~90%. | Do it — big DX/perf win. Needs visual regression testing. **Unblocks:** tailwind-merge 3, tailwind-scrollbar 4, prettier-plugin-tailwindcss 0.7. |
| ESLint        | 8→10      | Significant | Must migrate `.eslintrc` → `eslint.config.js` (flat config). All plugins must support flat config. Custom `eslint-local-rules/` need adaptation. Config lookup changes for monorepos.                                                                                                            | Do it — ESLint 8 is EOL. Budget half-day to full day. **Unblocks:** eslint-plugin-react-hooks 7, eslint-config-prettier 10.                      |
| Vite + Vitest | 7→8 / 2→4 | Significant | **Vite:** Rolldown replaces esbuild+Rollup (10-30x faster). CJS interop changes may break SSR. LightningCSS built-in. **Vitest:** `poolOptions` removed. `vi.fn().getMockName()` returns `"vi.fn()"`. Coverage remapping changes.                                                                | Do together. CJS interop with SSR + `@shelf/database` is biggest risk. **Unblocks:** @vitejs/plugin-react 6.                                     |
| Prisma        | 6→7       | Significant | `prisma.config.ts` required. Driver adapters mandatory (`@prisma/adapter-pg` + `pg`). ESM-only client. No auto `.env` loading. Rust engine → TypeScript.                                                                                                                                         | **Defer.** v6 still supported. Needs rewrite of `createDatabaseClient()`, new config, updated `db:*` scripts.                                    |
| pg-boss       | 9→12      | Significant | Major rewrite in v11. No auto-migration from v10 or lower. Queue partitioning changed. `insert()` signature changed. Must manually move jobs via API/SQL.                                                                                                                                        | **Defer.** High risk for production job queues. Only do if specific features needed.                                                             |
| pnpm          | 9→10      | Moderate    | Node >= 22 required (fine). Lifecycle scripts blocked by default — must whitelist in `pnpm.onlyBuiltDependencies`. Pure ESM.                                                                                                                                                                     | Do first or last, not mid-upgrade. Identify packages needing build steps (prisma, sharp, native modules).                                        |

---

## Major Updates — Blocked

These cannot be upgraded until their dependencies are upgraded first.

| Package                     | Current | Target | Blocked by              |
| --------------------------- | ------- | ------ | ----------------------- |
| tailwind-merge              | 2.x     | 3.x    | Tailwind CSS 4          |
| tailwind-scrollbar          | 3.x     | 4.x    | Tailwind CSS 4          |
| @vitejs/plugin-react        | 5.x     | 6.x    | Vite 8                  |
| eslint-plugin-react-hooks   | 4.x     | 7.x    | ESLint 9+ (flat config) |
| prettier-plugin-tailwindcss | 0.5     | 0.7    | Likely Tailwind CSS 4   |

---

## Recommended Batching Strategy

### Batch 1 — Safe updates (patch/minor + trivial majors)

All 21 patch/minor updates plus all 18 Tier 1 trivial major updates. Run `pnpm webapp:validate` after each sub-group.

### Batch 2 — Moderate majors

TypeScript 6, Zod 4, Stripe 22, lucide-react 1.x, @faker-js/faker 10, dotenv-cli 11, qrcode-generator 2, zxing packages. Each can be done independently.

### Batch 3 — Tailwind 4 + Vite 8 + Vitest 4 + blocked deps

Do together since they share LightningCSS and version dependencies. Unblocks tailwind-merge 3, tailwind-scrollbar 4, @vitejs/plugin-react 6, prettier-plugin-tailwindcss 0.7.

### Batch 4 — Infrastructure (each is its own mini-project)

- ESLint 10 (flat config migration) → unblocks eslint-plugin-react-hooks 7
- Prisma 7 (driver adapter refactor)
- pg-boss 12 (job queue migration)
- pnpm 10 (package manager upgrade)

---

## How to run taze

```bash
# Dry run — see what's outdated (default, no changes)
pnpm dlx taze major -r

# Interactive — pick which deps to update, then write
pnpm dlx taze major -r -I -w

# Write all updates (careful!)
pnpm dlx taze major -r -w

# After writing, reinstall
pnpm install

# Validate everything
pnpm webapp:validate
```
