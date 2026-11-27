/**
 * Booking sources input
 *
 * The request shape for choosing where a booking slice's units come from, on
 * the adjust-quantity action (web and mobile):
 *
 * - `{ mode: "AUTO" }` returns the slice to the allocation rule.
 * - `{ mode: "MANUAL", sources: [...] }` sets the planned units (pending plus
 *   out) per source by hand: a location id for a manual placement of the
 *   asset, or `null` for its unplaced units.
 *
 * The schema checks shape only: at most {@link MAX_SOURCES_INPUT} entries,
 * whole numbers of at least 0, each location named once, at most one
 * Unplaced entry. What depends on stored state is checked by the service
 * inside its transaction: every location must be a placement of the asset
 * (a foreign, non-placement or missing id all get the same 400, so the
 * schema never tells them apart), the list is therefore never longer than
 * the placements plus Unplaced, and the units must add up to the slice's
 * planned units.
 *
 * The web form sends the object as JSON in one hidden field named
 * {@link SOURCES_FORM_FIELD} (parsed with {@link sourcesFormFieldSchema});
 * the mobile JSON body carries it as a `sources` property (parsed with
 * {@link bookingSourcesInputSchema}).
 *
 * @see {@link file://./booking-sources.server.ts} setManualSources / setAutoSources
 * @see {@link file://../booked-quantity.server.ts} the adjust-quantity service
 */

import { z } from "zod";

/** Hard cap on the number of sources one request may name. */
export const MAX_SOURCES_INPUT = 50;

/** Name of the hidden web form field that carries the sources JSON. */
export const SOURCES_FORM_FIELD = "sources";

/** One source and the planned units wanted there. */
const sourceEntrySchema = z.object({
  /** A manual placement's location id, or null for Unplaced. */
  locationId: z.string().trim().min(1).max(100).nullable(),
  quantity: z
    .number()
    .int("Each source needs a whole number of units.")
    .min(0, "A source cannot have fewer than 0 units.")
    .max(1_000_000),
});

/** The parsed sources request. */
export type BookingSourcesInput =
  | { mode: "AUTO" }
  | {
      mode: "MANUAL";
      sources: Array<{ locationId: string | null; quantity: number }>;
    };

/**
 * Validates a sources request. MANUAL lists hold 1 to
 * {@link MAX_SOURCES_INPUT} entries, each location at most once and at most
 * one Unplaced (`null`) entry.
 */
export const bookingSourcesInputSchema: z.ZodType<BookingSourcesInput> =
  z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("AUTO") }),
    z.object({
      mode: z.literal("MANUAL"),
      sources: z
        .array(sourceEntrySchema)
        .min(1, "Choose at least one source.")
        .max(MAX_SOURCES_INPUT, "Too many sources.")
        .superRefine((sources, ctx) => {
          const seen = new Set<string | null>();
          for (const source of sources) {
            if (seen.has(source.locationId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                  source.locationId === null
                    ? "Unplaced can be chosen only once."
                    : "Each location can be chosen only once.",
              });
              return;
            }
            seen.add(source.locationId);
          }
        }),
    }),
  ]);

/**
 * Reads JSON text when it parses, else hands the value back unchanged so the
 * schema reports it as invalid.
 */
function readJsonText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.trim() === "") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * The optional web form field {@link SOURCES_FORM_FIELD}: JSON text of a
 * {@link BookingSourcesInput}. A missing or blank field parses to
 * `undefined` ("leave the sources alone"); text that is not valid JSON or
 * fails {@link bookingSourcesInputSchema} fails validation (a 400 through
 * `parseData`).
 */
export const sourcesFormFieldSchema = z.preprocess(
  readJsonText,
  bookingSourcesInputSchema.optional()
);
