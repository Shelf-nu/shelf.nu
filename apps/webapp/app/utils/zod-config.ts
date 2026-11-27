/**
 * Zod Global Configuration
 *
 * Sets the app-wide default validation messages. Importing this module once is
 * enough: zod reads the configured error map each time a schema parses, so it
 * applies to every schema, including those built before the import ran.
 *
 * It is imported for its side effect by `app/root.tsx` (which loads on both the
 * server and the client) and by the Vitest setup file, so tests see the same
 * messages users do.
 *
 * A message set on a schema itself (`z.string({ error })`, `.min(1, "...")`)
 * always wins over this one.
 *
 * @see {@link file://./zod.ts} `requiredError` and `invalidTypeError`, for a
 *   field that needs its own wording
 */
import { z } from "zod";

/** Shown when a field with no message of its own receives no value at all. */
export const REQUIRED_MESSAGE = "Required";

z.config({
  customError: (issue) =>
    // A missing value surfaces as an `invalid_type` issue whose input is
    // `undefined`. Zod's own wording for it ("Invalid input: expected string,
    // received undefined") is not something to show a person filling in a form.
    issue.code === "invalid_type" && issue.input === undefined
      ? REQUIRED_MESSAGE
      : undefined,
});
