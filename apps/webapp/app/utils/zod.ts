import type { ZodCustomIssue, ZodIssue } from "zod";
import { z } from "zod";

type ZodCustomIssueWithMessage = ZodCustomIssue & { message: string };

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
