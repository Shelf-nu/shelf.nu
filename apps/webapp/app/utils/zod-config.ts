/**
 * Zod Global Configuration
 *
 * Owns the wording of every validation message that a schema does not word
 * itself. Zod's built-in messages ("Too small: expected string to have >=1
 * characters", "Invalid option: expected one of ...") describe the schema, not
 * what the person filling in a form should do, so none of them may reach the
 * UI. {@link defaultValidationMessage} gives each kind of failure a plain
 * sentence instead, and always returns one.
 *
 * A message set on a schema itself (`.min(1, "Name is required")`,
 * `z.string({ error })`, `.refine(fn, { message })`) always wins over this
 * map. Use one whenever the field deserves more specific wording than the
 * generic sentence here: these messages do not know the field's name.
 *
 * Importing this module once is enough: zod reads the configured map each time
 * a schema parses, so it applies to every schema, including those built before
 * the import ran. It is imported for its side effect by `app/root.tsx` (which
 * loads on both the server and the client) and by the Vitest setup file, so
 * tests see the same messages users do.
 *
 * @see {@link file://./zod.ts} `requiredError` and `invalidTypeError`, for a
 *   field that needs its own wording
 * @see {@link file://./zod-config.test.ts} pins the wording for each failure
 */
import { z } from "zod";

/** Shown when a field receives no value, or only an empty one. */
export const REQUIRED_MESSAGE = "Required";

/** Shown when nothing more specific can be said about a rejected value. */
export const INVALID_VALUE_MESSAGE = "Invalid value";

/** A failure as zod describes it to an error map, before it has a message. */
type RawIssue = z.core.$ZodRawIssue;

/**
 * Formats a bound for display, so a limit of 10000 reads "10,000".
 *
 * @param value - A numeric bound taken from a schema check
 * @returns The bound as text; a non-number is returned as its string form
 */
function formatBound(value: unknown): string {
  return typeof value === "number" || typeof value === "bigint"
    ? value.toLocaleString("en-US")
    : String(value);
}

/**
 * The message for a value that is shorter, smaller or fewer than allowed.
 *
 * @param issue - A `too_small` issue
 * @returns The sentence to show
 */
function tooSmallMessage(
  issue: Extract<RawIssue, { code: "too_small" }>
): string {
  const min = formatBound(issue.minimum);

  switch (issue.origin) {
    case "string":
      // A minimum of one character is how a schema says "not blank".
      if (issue.minimum === 1 && issue.inclusive !== false) {
        return REQUIRED_MESSAGE;
      }
      return issue.exact
        ? `Must be exactly ${min} characters`
        : `Must be at least ${min} characters`;
    case "array":
    case "set":
      return issue.minimum === 1 && issue.inclusive !== false
        ? "Select at least one"
        : `Select at least ${min}`;
    case "date":
      return "Date is too early";
    case "file":
      return "File is too small";
    default:
      return issue.inclusive === false
        ? `Must be greater than ${min}`
        : `Must be at least ${min}`;
  }
}

/**
 * The message for a value that is longer, larger or more numerous than allowed.
 *
 * @param issue - A `too_big` issue
 * @returns The sentence to show
 */
function tooBigMessage(issue: Extract<RawIssue, { code: "too_big" }>): string {
  const max = formatBound(issue.maximum);

  switch (issue.origin) {
    case "string":
      return issue.exact
        ? `Must be exactly ${max} characters`
        : `Must be at most ${max} characters`;
    case "array":
    case "set":
      return `Too many items. The limit is ${max}.`;
    case "date":
      return "Date is too late";
    case "file":
      return "File is too large";
    default:
      return issue.inclusive === false
        ? `Must be less than ${max}`
        : `Must be at most ${max}`;
  }
}

/**
 * The message for a value of the wrong type, which includes a missing one.
 *
 * @param issue - An `invalid_type` issue
 * @returns The sentence to show
 */
function invalidTypeMessage(
  issue: Extract<RawIssue, { code: "invalid_type" }>
): string {
  // A field that was never sent arrives as `undefined`; a cleared one can
  // arrive as `null`. Both mean the person gave no answer.
  if (issue.input === undefined || issue.input === null) {
    return REQUIRED_MESSAGE;
  }

  switch (issue.expected) {
    case "int":
      // `.int()` on a value that is a number but not a whole one.
      return typeof issue.input === "number" && !Number.isNaN(issue.input)
        ? "Must be a whole number"
        : "Must be a number";
    case "number":
    case "bigint":
      return "Must be a number";
    case "date":
      return "Must be a valid date";
    default:
      return INVALID_VALUE_MESSAGE;
  }
}

/**
 * The message for text that does not match a required format.
 *
 * @param issue - An `invalid_format` issue
 * @returns The sentence to show
 */
function invalidFormatMessage(
  issue: Extract<RawIssue, { code: "invalid_format" }>
): string {
  switch (issue.format) {
    case "email":
      return "Please enter a valid email";
    case "url":
      return "Please enter a valid URL";
    case "date":
    case "datetime":
      return "Please enter a valid date";
    case "time":
      return "Please enter a valid time";
    default:
      return "Invalid format";
  }
}

/**
 * The default message for a validation failure, used whenever the schema that
 * raised it set no message of its own.
 *
 * Always returns a sentence, so zod's built-in wording is never the fallback.
 *
 * @param issue - The failure, as zod hands it to an error map
 * @returns The message to show the user
 */
export function defaultValidationMessage(issue: RawIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return invalidTypeMessage(issue);
    case "too_small":
      return tooSmallMessage(issue);
    case "too_big":
      return tooBigMessage(issue);
    case "invalid_format":
      return invalidFormatMessage(issue);
    case "not_multiple_of":
      return `Must be a multiple of ${formatBound(issue.divisor)}`;
    case "invalid_value":
      // One allowed value is a literal (a checkbox that must be "on"); several
      // are a choice between options.
      return issue.values.length > 1
        ? "Please select a valid option"
        : INVALID_VALUE_MESSAGE;
    default:
      // unrecognized_keys, invalid_union, invalid_key, invalid_element and a
      // custom issue raised without a message.
      return INVALID_VALUE_MESSAGE;
  }
}

z.config({ customError: defaultValidationMessage });
