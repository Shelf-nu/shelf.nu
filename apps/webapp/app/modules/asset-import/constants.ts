/**
 * Asset import constants
 *
 * Tuning values for the background CSV content import. Kept free of server
 * imports so the progress UI can share the poll interval.
 *
 * @see {@link file://./worker.server.ts}
 */

/** Rows written per transaction. One chunk is one pg-boss job. */
export const ASSET_IMPORT_CHUNK_SIZE = 100;

/**
 * The largest file the background import accepts, in data rows. Each row is
 * stored on the draft until the import completes and imported in chunks of
 * ASSET_IMPORT_CHUNK_SIZE, so time and draft size grow linearly with it.
 */
export const MAX_BACKGROUND_IMPORT_ROWS = 10_000;

/** The largest CSV upload the background import accepts, in bytes (10 MB). */
export const MAX_BACKGROUND_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

/** How often the browser asks for progress while an import is queued or running. */
export const ASSET_IMPORT_POLL_INTERVAL_SECONDS = 2;

/**
 * The job expiry of every import step, and the bound on its lease.
 *
 * Invariant: a lease is strictly shorter than the job expiry. A claim holds
 * the import for `ASSET_IMPORT_LEASE_MINUTES - 1` minutes and is never renewed,
 * so when a process dies mid-step, its lease has always lapsed by the time
 * pg-boss retries the expired job, and the retry continues the chain. A live
 * step finishes well inside the lease because the image phase is capped at
 * `ASSET_IMPORT_IMAGE_BUDGET_MS` (8 minutes) and the chunk transaction at 30
 * seconds.
 */
export const ASSET_IMPORT_LEASE_MINUTES = 15;

/**
 * How long to hold back the next step when the previous step could not
 * release its lease: the lease length (`ASSET_IMPORT_LEASE_MINUTES - 1`
 * minutes) plus 30 seconds of margin. Started any earlier, the next step's
 * claim would find the lease still held and return as a duplicate, which
 * stops the chain until stall detection. Measured from the release, which
 * comes after the claim, so the lease has always lapsed by then.
 */
export const ASSET_IMPORT_UNRELEASED_LEASE_DELAY_SECONDS =
  (ASSET_IMPORT_LEASE_MINUTES - 1) * 60 + 30;

/**
 * A QUEUED or RUNNING import untouched for this long is treated as stopped.
 * Confirm, resume, every lease claim and every chunk bump `updatedAt`, so the
 * longest legitimate silence is one job expiry plus backoff, about 16 minutes.
 */
export const ASSET_IMPORT_STALL_MINUTES = 60;

/**
 * Time one ROWS chunk may spend downloading images before it writes its rows.
 * Rows not reached in time are imported without an image and get a warning.
 * Must stay well under the step's lease (one minute less than the 15-minute
 * job expiry, `ASSET_IMPORT_LEASE_MINUTES`): the lease is never renewed, so a
 * step that outlives it could overlap a retry of the same step.
 */
export const ASSET_IMPORT_IMAGE_BUDGET_MS = 8 * 60 * 1000;

/** A DRAFT older than this can no longer be confirmed; the user uploads again. */
export const ASSET_IMPORT_DRAFT_TTL_HOURS = 24;

/** Warnings kept on the import row. `warningCount` keeps the exact total. */
export const MAX_STORED_IMPORT_WARNINGS = 500;

/**
 * pg-boss send options for every import step. A step that throws is retried
 * three times with exponential backoff starting at 5 seconds. A step whose
 * process dies is retried once it expires after 15 minutes.
 */
export const ASSET_IMPORT_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelay: 5,
  retryBackoff: true,
  expireInMinutes: ASSET_IMPORT_LEASE_MINUTES,
} as const;

/** Maximum number of rows shown in an import preview grid. */
export const PREVIEW_DISPLAY_LIMIT = 100;
