/**
 * Recognising why a `parseFormData` call failed.
 *
 * `parseFormData` does not surface the error that stopped it. Anything thrown
 * while reading the body comes back wrapped in a `FormDataParseError` with the
 * real error on `.cause`, so testing the thrown value directly with `instanceof`
 * never matches and the caller falls through to its generic handler. Ask through
 * these helpers instead, which walk the chain.
 *
 * @see {@link file://./storage.server.ts}
 * @see {@link file://./csv.server.ts}
 */
import { MaxFileSizeExceededError } from "@remix-run/form-data-parser";

/**
 * The `MaxFileSizeExceededError` behind a failed parse, if that is what it was.
 *
 * Walks iteratively and remembers what it has already looked at, because a
 * `cause` chain is not guaranteed to be finite: one that loops back on itself
 * would otherwise exhaust the stack inside the request handler, turning a
 * too-large upload into a crash.
 *
 * @param error - Whatever `parseFormData` rejected with
 * @returns The underlying error, or null when the parse failed for another reason
 */
export function getMaxFileSizeExceededError(
  error: unknown
): MaxFileSizeExceededError | null {
  const seen = new Set<unknown>();
  let current = error;

  while (current !== null && current !== undefined && !seen.has(current)) {
    if (current instanceof MaxFileSizeExceededError) {
      return current;
    }

    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

/**
 * Whether a failed parse was caused by a file exceeding the size limit.
 *
 * @param error - Whatever `parseFormData` rejected with
 * @returns true when the cause chain holds a `MaxFileSizeExceededError`
 */
export function isMaxFileSizeError(error: unknown): boolean {
  return getMaxFileSizeExceededError(error) !== null;
}
