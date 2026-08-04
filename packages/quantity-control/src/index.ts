/**
 * `@shelf/quantity-control` — public entrypoint.
 *
 * Pure, dependency-free domain for Shelf's QUANTITY_TRACKED availability math.
 * Zero runtime dependencies; no `@prisma/client`, no database, no React.
 *
 * Distribution: shipped as raw TypeScript `src` (mirrors `@shelf/database`), so
 * there is no build step and no `dist/` to drift. The webapp consumes the
 * source directly through two independent paths: Vite — and Vitest, which runs
 * on Vite's SSR pipeline — bundle it because it is listed in `ssr.noExternal`
 * (see `apps/webapp/vite.config.ts`); TypeScript resolves it via this package's
 * `exports` `src` entrypoint and type-checks the source through its own module
 * resolution (`tsc` never reads the Vite config). When the companion app
 * (Metro, which cannot
 * consume raw TS) is wired to this package in the mobile lane, add a compiled
 * output THEN — do not reintroduce a `prepare` script: it runs during the
 * turbo-pruned Docker `deps` install where the source/tsconfig are absent and
 * breaks the image build.
 *
 * @see {@link file://./types.ts} — shared enums + value-objects.
 * @see {@link file://./availability.ts} — peak/sweep/formula primitives.
 * @see {@link file://./guards.ts} — pure availability verdicts + cause/cure copy.
 * @see {@link file://./low-stock.ts} — low-stock threshold predicates.
 * @see {@link file://./dispositions.ts} — check-in disposition arithmetic.
 * @see {@link file://./format.ts} — unit-count formatting.
 */

export * from "./types.js";
export * from "./availability.js";
export * from "./guards.js";
export * from "./low-stock.js";
export * from "./dispositions.js";
export * from "./format.js";
