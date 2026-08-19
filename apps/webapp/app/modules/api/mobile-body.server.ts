/**
 * Mobile API request-body validation.
 *
 * The `api+/mobile+/*` actions validate their JSON body with a Zod schema and
 * then let the route's outer `catch` turn anything thrown into a response. A
 * bare `schema.parse()` throws a `ZodError`, which `makeShelfError` does not
 * recognise — it falls through to the generic branch and becomes a **500** with
 * the message "Sorry, something went wrong.", captured to Sentry. That is the
 * wrong answer for a malformed client payload twice over: the caller gets a
 * server-error status for their own bad input, and the noise reaches Sentry.
 *
 * This helper converts the `ZodError` into the same shape the routes already use
 * for their `BookingFormSchema` validation — a 400 carrying the first
 * user-facing message, with `shouldBeCaptured: false`.
 *
 * @see {@link file://../../utils/error.ts} makeShelfError — the generic branch this avoids
 * @see {@link file://../../utils/http.server.ts} parseData — the FormData equivalent for web routes
 */
import { z } from "zod";
import { ShelfError } from "~/utils/error";

/**
 * Parse a mobile JSON body against a Zod schema, surfacing validation failures
 * as a 400 rather than an uncaptured 500.
 *
 * @param schema - The Zod schema describing the expected body.
 * @param body - The parsed JSON from `await request.json()`.
 * @returns The validated, typed body.
 * @throws {ShelfError} 400 (not captured) when validation fails; rethrows
 *   anything that is not a `ZodError` untouched.
 */
export function parseMobileBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  body: unknown
): z.infer<Schema> {
  try {
    return schema.parse(body);
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      throw new ShelfError({
        cause,
        // Name the offending field so "Time zone must be a valid IANA zone"
        // reaches the client instead of a generic failure.
        message: cause.errors[0]?.message ?? "Invalid request body.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }
    throw cause;
  }
}
