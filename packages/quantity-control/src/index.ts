/**
 * `@shelf/quantity-control` — public entrypoint.
 *
 * Pure, dependency-free domain for Shelf's QUANTITY_TRACKED availability math.
 * Zero runtime dependencies; no `@prisma/client`, no database, no React.
 *
 * Distribution: shipped as raw TypeScript `src` (mirrors `@shelf/database`).
 * The webapp consumes it directly — Vite/Vitest/tsc compile the source via
 * `ssr.noExternal` (see `apps/webapp/vite.config.ts`), so there is no build
 * step and no `dist/` to drift. When the companion app (Metro, which cannot
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
