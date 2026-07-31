/**
 * `@shelf/quantity-control` — public entrypoint.
 *
 * Pure, dependency-free domain for Shelf's QUANTITY_TRACKED availability math,
 * consumed by both the webapp (as the pure decisions behind its Prisma-backed
 * guards/reads) and the companion app (client-side display/validation). Zero
 * runtime dependencies; no `@prisma/client`, no database, no React.
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
