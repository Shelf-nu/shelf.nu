/**
 * Ordered streaming deadlines for the advanced asset index.
 *
 * The index loader returns some fields eagerly and defers the rest (per-row
 * hydration data) as promises streamed to the client via React Router's
 * Single-Fetch turbo-stream. Three clocks race against each other for every
 * request, and their ORDER is the invariant the rest of this module relies on:
 *
 * - {@link HYDRATION_DEADLINE_MS} stops the read limiter ({@link
 *   file://./../../../utils/read-batch-limiter.server.ts}) from STARTING new
 *   queued hydration queries. It fires first, and deliberately earlier than
 *   the stream timeout, so a query is never begun only to be orphaned by the
 *   stream aborting underneath it.
 * - {@link STREAM_TIMEOUT_MS} is when React Router's turbo-stream gives up on
 *   a still-pending deferred promise and rejects it for the client.
 * - {@link ABORT_DELAY_MS} is the outer `entry.server` abort delay for the
 *   whole document render shell — the last resort if the stream itself hangs.
 *
 * Invariant: `HYDRATION_DEADLINE_MS < STREAM_TIMEOUT_MS < ABORT_DELAY_MS`.
 * Widening any deadline without preserving that ordering reintroduces
 * orphaned queries (hydration work started after the stream has already
 * timed out, holding a DB connection nothing will ever read the result of).
 */

/**
 * Cutoff, in ms from request start, after which the read limiter stops
 * starting new queued hydration queries and instead rejects them so their
 * slot is never occupied by work that can no longer reach the client.
 */
export const HYDRATION_DEADLINE_MS = 4000;

/**
 * Cutoff, in ms from request start, after which React Router's Single-Fetch
 * turbo-stream abandons a still-pending deferred hydration promise and
 * rejects it for the client.
 */
export const STREAM_TIMEOUT_MS = 4500;

/**
 * Cutoff, in ms from request start, for the document-render shell's own
 * abort delay — the outermost safety net if the stream itself never settles.
 */
export const ABORT_DELAY_MS = 5000;
