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

/** How often the browser asks for progress while an import is queued or running. */
export const ASSET_IMPORT_POLL_INTERVAL_SECONDS = 2;

/**
 * How long a step holds an import before another run may take it over. Equal
 * to the job expiry, so by the time pg-boss retries a step whose process died,
 * that process's lease has lapsed.
 */
export const ASSET_IMPORT_LEASE_MINUTES = 15;

/**
 * A RUNNING import untouched for this long is treated as stopped. Every lease
 * claim and renewal bumps `updatedAt`, so the longest legitimate silence is one
 * expiry plus backoff, about 16 minutes.
 */
export const ASSET_IMPORT_STALL_MINUTES = 30;

/**
 * Time one ROWS chunk may spend downloading images before it writes its rows.
 * Rows not reached in time are imported without an image and get a warning.
 * Must stay well under the 15-minute job expiry (`ASSET_IMPORT_LEASE_MINUTES`):
 * pg-boss gives up on a handler at expiry, and a step that outlives it is no
 * longer tracked or retried.
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
export const PREVIEW_DISPLAY_LIMIT = 50;
