/**
 * Mobile Custom Fields helpers
 *
 * Shared validation + reshape logic for the mobile asset create/update
 * routes when they accept a `customFields: [{ id, value }]` payload.
 *
 * Lives in `modules/api/` because it's transport-layer plumbing — it sits
 * between the incoming JSON body and the existing
 * `extractCustomFieldValuesFromPayload` helper that both create and update
 * already go through. The webapp form path bypasses this file entirely;
 * it has its own form-data → zod (`mergedSchema`) pipeline.
 *
 * Why a shared module: the create and update routes used to duplicate
 * BOOLEAN normalisation + unknown-id rejection + the `cf-{id}` reshape
 * verbatim. Drifting them is silent — if a new custom-field type is added
 * tomorrow and only one route is updated, the other regresses. This file
 * is the single source of truth for that transport step.
 *
 * @see {@link file://./../../utils/custom-fields.ts} — `extractCustomFieldValuesFromPayload`
 * @see {@link file://./../../routes/api+/mobile+/asset.create.ts}
 * @see {@link file://./../../routes/api+/mobile+/asset.update.ts}
 * @see {@link file://./../../routes/api+/mobile+/custom-fields.ts}
 */

/**
 * Sentinel value used in mobile API requests to mean "no category" /
 * "uncategorized". Standardised so both client and server agree on the
 * exact string and renaming it in the future only touches this constant.
 */
export const UNCATEGORIZED_SENTINEL = "uncategorized" as const;

/**
 * Minimal shape of a custom field definition this helper needs. We
 * deliberately don't depend on the full Prisma `CustomField` row so the
 * helper can be reused with the trimmed `select`ed shapes the mobile
 * routes use.
 */
type CustomFieldDefShape = {
  id: string;
  type: string;
};

/**
 * Result of {@link buildMobileCustomFieldPayload}. A tagged union so the
 * caller pattern-matches against `ok` rather than checking for an
 * exception or a magic value.
 */
export type BuildMobileCustomFieldPayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; unknownId: string };

/**
 * Validates a mobile-submitted `customFields` array against the active
 * definitions for the relevant category and reshapes it into the
 * `cf-{id}` keyed form that
 * {@link file://./../../utils/custom-fields.ts | `extractCustomFieldValuesFromPayload`}
 * expects.
 *
 * Performs the cross-cutting concerns shared by mobile create + update:
 *
 * 1. **Rejects unknown ids up front.** If the caller submits a `cf.id`
 *    not in `defs`, returns `{ ok: false, unknownId }`. Without this,
 *    `extractCustomFieldValuesFromPayload` deref's a missing definition
 *    via a non-null assertion and crashes as a 500.
 *
 * 2. **Normalises BOOLEAN string values.** The companion's
 *    `CustomFieldInput` emits `"true"` / `"false"` strings; the webapp's
 *    `buildCustomFieldValue` recognises `"yes"` / `"no"` strings or real
 *    booleans, but NOT `"true"` / `"false"`. Without the normalisation
 *    required BOOLEAN fields pass the non-empty required check then get
 *    silently dropped to `undefined` and persisted as `null`.
 *
 * The "required field totality" check (create) and the "no explicit
 * clear of a required field" check (update) are layered by the calling
 * route on top of this helper; this helper is shape-and-coerce only.
 *
 * @param submitted - The `customFields` array from the parsed request body.
 * @param defs - Active custom-field definitions for the relevant category
 *   (already filtered by org + active flag + category by the caller).
 * @returns A tagged union: `{ ok: true, payload }` with the `cf-{id}`
 *   keyed payload on success, or `{ ok: false, unknownId }` when the
 *   caller submitted a `cf.id` that isn't in `defs`.
 */
export function buildMobileCustomFieldPayload(
  submitted: { id: string; value: unknown }[],
  defs: CustomFieldDefShape[]
): BuildMobileCustomFieldPayloadResult {
  const defById = new Map(defs.map((def) => [def.id, def]));

  const unknown = submitted.find((cf) => !defById.has(cf.id));
  if (unknown) {
    return { ok: false, unknownId: unknown.id };
  }

  const payload = Object.fromEntries(
    submitted.map((cf) => {
      const def = defById.get(cf.id)!;
      // why: CustomFieldInput emits "true"/"false" strings for BOOLEAN
      // fields, but buildCustomFieldValue recognises only "yes"/"no" or
      // real booleans. Normalise here so required BOOLEAN values
      // survive the coercion step instead of being dropped to undefined.
      const value =
        def.type === "BOOLEAN" && typeof cf.value === "string"
          ? cf.value === "true"
          : cf.value;
      return [`cf-${cf.id}`, value];
    })
  );

  return { ok: true, payload };
}
