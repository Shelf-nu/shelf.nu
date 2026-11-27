import type { ZodIssue } from "zod";
import { z } from "zod";

/**
 * The most entries any list in a request may hold: `.max(MAX_LIST_ITEMS)` on
 * every `z.array()`.
 *
 * It is a safety bound, not a product limit. Zod checks a list's length before
 * it looks at the entries, so a list over the cap is refused at once instead
 * of being validated entry by entry. The number sits far above anything the
 * app sends on purpose: the "manage assets" pages submit every member of a
 * booking, kit or location in one list, which can run to thousands, while
 * "select all" across pages sends a marker rather than the ids.
 *
 * A list that needs a tighter, user-facing limit sets its own `.max()` with a
 * message, as the bulk asset count does.
 */
export const MAX_LIST_ITEMS = 10_000;

/** A custom issue in the shape react-zorm accepts as `customIssues`. */
type ZodCustomIssueWithMessage = {
  code: "custom";
  message: string;
  path: ZodIssue["path"];
};

/**
 * Schema params that give a field its own message when no value is sent at
 * all (the input is `undefined`), and leave every other failure to the checks
 * chained after it.
 *
 * @param message - What to show when the field is missing
 * @returns Params for a zod schema constructor, such as `z.string(...)`
 */
export function requiredError(message: string) {
  return {
    error: (issue: { input?: unknown }) =>
      issue.input === undefined ? message : undefined,
  };
}

/**
 * Schema params that give a field its own message when a value is sent but has
 * the wrong type, and leave a missing value to the default message.
 *
 * @param message - What to show when the value has the wrong type
 * @returns Params for a zod schema constructor, such as `z.number(...)`
 */
export function invalidTypeError(message: string) {
  return {
    error: (issue: { input?: unknown }) =>
      issue.input === undefined ? undefined : message,
  };
}

export function createFormIssues(
  issues?: ZodIssue[]
): ZodCustomIssueWithMessage[] | undefined {
  return issues?.map(({ message, path }) => ({
    code: "custom",
    message,
    path,
  }));
}

export function zodFieldIsOptional(field: any) {
  return field instanceof z.ZodOptional;
}

export function zodFieldIsRequired(field: any) {
  return (
    !(field instanceof z.ZodOptional) &&
    !(field instanceof z.ZodNullable) &&
    field?._def?.checks?.length > 0
  );
}

export const stringToJSONSchema = z
  .string()
  .transform((str, ctx): z.infer<ReturnType<typeof JSON.parse>> => {
    try {
      return JSON.parse(str);
    } catch (_e) {
      ctx.addIssue({ code: "custom", message: "Invalid JSON" });
      return z.NEVER;
    }
  });

/**
 * Maximum password length accepted by Supabase's auth provider, in **UTF-8
 * bytes** (not characters).
 *
 * GoTrue hashes passwords with bcrypt, which only considers the first 72
 * bytes, so Supabase rejects anything longer with
 * `AuthApiError: Password cannot be longer than 72 characters`. Because bcrypt
 * counts bytes, a password like `"é".repeat(40)` is only 40 characters but 80
 * UTF-8 bytes — it must be rejected even though it looks short. Mirroring the
 * byte limit in our zod schemas turns that late, captured 500 into an early,
 * field-level validation error (SHELF-WEBAPP-21A).
 */
export const PASSWORD_MAX_LENGTH = 72;

/** User-facing message shown when a password exceeds {@link PASSWORD_MAX_LENGTH}. */
export const PASSWORD_MAX_LENGTH_MESSAGE =
  "Password cannot be longer than 72 characters.";

/**
 * Shared validation schema for password *setter* flows (signup, onboarding,
 * password reset). Enforces both the 8-character minimum and the 72-**byte**
 * bcrypt/Supabase maximum so every setter rejects out-of-range passwords the
 * same way, before they ever reach the auth provider.
 *
 * The upper bound is checked as UTF-8 byte length rather than `.max()` (which
 * counts UTF-16 code units) because bcrypt limits by bytes — a 40-character
 * multi-byte password can be 80 bytes and must still be rejected
 * (SHELF-WEBAPP-21A).
 *
 * @param minMessage - Flow-specific "too short" copy so each form keeps its
 *   existing wording. Defaults to the signup message.
 * @returns A `z.ZodString` schema with a `min(8)` check and a UTF-8 byte-length
 *   refinement capped at {@link PASSWORD_MAX_LENGTH}.
 */
export function passwordSchema(
  minMessage = "Your password is too short. Min 8 characters are required."
) {
  return z
    .string()
    .min(8, minMessage)
    .refine(
      (value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_LENGTH,
      { message: PASSWORD_MAX_LENGTH_MESSAGE }
    );
}
