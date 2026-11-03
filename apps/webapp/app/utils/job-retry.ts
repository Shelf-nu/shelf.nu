/**
 * Job retry helpers
 *
 * Shared by the pg-boss workers, which log a failure only on the attempt
 * pg-boss will not retry, so a job that recovers on a retry never reaches
 * Sentry and one that does not is reported exactly once.
 *
 * Kept apart from `scheduler.server.ts` so a test that replaces the scheduler
 * module still gets the real check.
 *
 * @see {@link file://./scheduler.server.ts}
 */

/** The retry metadata pg-boss attaches to a job fetched with `includeMetadata`. */
type JobRetryMetadata = {
  retrycount?: number | null;
  retrylimit?: number | null;
};

/**
 * Whether pg-boss will not retry this job again if it throws.
 *
 * pg-boss increments `retrycount` when it fetches the job, so with N retries
 * the handler sees 0, 1, ... N and the final attempt has
 * `retrycount === retrylimit`. Comparing against `retrylimit - 1` would fire
 * on the last two attempts.
 *
 * @param job - The running job, with its retry metadata
 * @returns `false` when the metadata is missing, so nothing is logged early
 */
export function isLastAttempt(job: JobRetryMetadata): boolean {
  return (
    job.retrycount != null &&
    job.retrylimit != null &&
    job.retrycount >= job.retrylimit
  );
}
