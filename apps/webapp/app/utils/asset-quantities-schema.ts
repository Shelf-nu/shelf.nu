/**
 * Shared Zod schema for the `assetQuantities` wire field used by the
 * Phase 4b location + kit pickers (and the corresponding scanner
 * drawers).
 *
 * Wire format: a JSON-encoded `Record<assetId, quantity>`. One entry
 * per selected QUANTITY_TRACKED row; INDIVIDUAL rows are absent — the
 * service treats missing entries as "use Asset.quantity" (full-pool
 * default, legacy behaviour for paths that don't expose a qty input).
 *
 * Why a single schema (vs. a per-route copy):
 *   - 2 pickers + 2 scanner routes all need the exact same parse +
 *     validation behaviour. Drift between them would silently produce
 *     different 400-vs-500 responses for the same malformed payload.
 *   - Server-side re-validation against the strict-available pool
 *     happens downstream in `updateLocationAssets` /
 *     `updateKitAssets` — this schema only guards the *shape* of the
 *     payload, not the *semantic* ceiling.
 *
 * Default empty-object input keeps action handlers working for
 * pure-INDIVIDUAL submissions where the picker has nothing to write.
 *
 * @see {@link file://./../routes/_layout+/locations.$locationId.assets.manage-assets.tsx}
 * @see {@link file://./../routes/_layout+/kits.$kitId.assets.manage-assets.tsx}
 */

import { z } from "zod";

/**
 * Parses the JSON blob the picker / scanner submits under
 * `assetQuantities`.
 *
 * The hand-rolled `JSON.parse` (vs. `z.record(z.coerce.number())`)
 * exists because:
 *
 *   - We need a single, well-shaped 400 when the field is missing,
 *     non-JSON, an array, a primitive, or contains a non-integer / NaN
 *     / negative value. Hand-rolling lets us surface an `Invalid
 *     quantities payload: <reason>` line per failure mode.
 *
 *   - The `unknown` cast is intentional. JSON.parse returns `any`,
 *     which silently swallows shape bugs further down. Narrowing to
 *     `unknown` and re-checking `typeof === "object"` (also excluding
 *     `null` and arrays — both of which would pass `typeof "object"`)
 *     forces the type system to keep us honest.
 *
 *   - Each entry's value gets coerced through `Number(v)` so a string
 *     `"5"` still parses (browsers sometimes serialise differently
 *     across form-encoders), but the result must be an integer ≥ 1.
 */
export const AssetQuantitiesSchema = z
  .string()
  .optional()
  .default("{}")
  .transform((raw, ctx): Record<string, number> => {
    try {
      const parsed: unknown = JSON.parse(raw);
      // Must be a plain object — `null` and arrays both register as
      // `typeof "object"` in JS, so they need explicit exclusion.
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("expected object");
      }
      const result: Record<string, number> = {};
      for (const [assetId, rawValue] of Object.entries(
        parsed as Record<string, unknown>
      )) {
        // Coerce strings through Number() — different form encoders
        // sometimes round-trip integers as strings.
        const value =
          typeof rawValue === "number" ? rawValue : Number(rawValue);
        if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
          throw new Error(`invalid quantity for ${assetId}`);
        }
        result[assetId] = value;
      }
      return result;
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid quantities payload: ${
          e instanceof Error ? e.message : "parse error"
        }`,
      });
      return z.NEVER;
    }
  });
