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
 * resolution (`tsc` never reads the Vite config). The companion app consumes
 * this same raw `src` entrypoint through Metro, which transpiles workspace
 * TypeScript via babel-preset-expo — `@shelf/datetime` ships the identical
 * `exports` map and is imported across the companion. Do NOT add a `prepare`
 * script to produce a compiled output: it runs during the turbo-pruned Docker
 * `deps` install where the source and tsconfig are absent, and breaks the
 * image build.
 *
 * Relative specifiers inside this package are written WITHOUT a file
 * extension, and must stay that way. Metro resolves a specifier by appending
 * its `sourceExts` to the literal path, so a NodeNext-style `./types.js` is
 * probed as `types.js`, `types.js.ts`, … and never finds `types.ts` — the
 * companion's bundle would fail on this entrypoint. `moduleResolution` is
 * `"Bundler"` (see `tooling/typescript/base.json`), so extensionless is
 * correct for `tsc`, Vite, Vitest and the package's own `tsx` test runner
 * alike.
 *
 * @see {@link file://./types.ts} — shared enums + value-objects.
 * @see {@link file://./availability.ts} — peak/sweep/formula primitives.
 * @see {@link file://./guards.ts} — pure availability verdicts + cause/cure copy.
 * @see {@link file://./low-stock.ts} — low-stock threshold predicates.
 * @see {@link file://./dispositions.ts} — check-in disposition arithmetic and
 *   the shared release-category predicate.
 * @see {@link file://./format.ts} — unit-count formatting.
 */

export * from "./types";
export * from "./availability";
export * from "./guards";
export * from "./low-stock";
export * from "./dispositions";
export * from "./format";
