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
 * Maximum password length accepted by Supabase's auth provider.
 *
 * GoTrue hashes passwords with bcrypt, which only considers the first 72
 * bytes, so Supabase rejects anything longer with
 * `AuthApiError: Password cannot be longer than 72 characters`. Mirroring the
 * limit in our zod schemas turns that late, captured 500 into an early,
 * field-level validation error (SHELF-WEBAPP-21A).
 */
export const PASSWORD_MAX_LENGTH = 72;

/** User-facing message shown when a password exceeds {@link PASSWORD_MAX_LENGTH}. */
export const PASSWORD_MAX_LENGTH_MESSAGE =
  "Password cannot be longer than 72 characters.";

/**
 * Shared validation schema for password *setter* flows (signup, onboarding,
 * password reset). Enforces both the 8-character minimum and the 72-character
 * bcrypt/Supabase maximum so every setter rejects out-of-range passwords the
 * same way, before they ever reach the auth provider.
 *
 * @param minMessage - Flow-specific "too short" copy so each form keeps its
 *   existing wording. Defaults to the signup message.
 * @returns A `z.ZodString` schema with `min(8)` and `max(72)` checks.
 */
export function passwordSchema(
  minMessage = "Your password is too short. Min 8 characters are required."
) {
  return z
    .string()
    .min(8, minMessage)
    .max(PASSWORD_MAX_LENGTH, PASSWORD_MAX_LENGTH_MESSAGE);
}
