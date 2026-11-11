/**
 * Sanitizer for the `assetExtraInclude` / `kitExtraInclude` query params on the
 * scanned-item lookup endpoints.
 *
 * Those params are user-controlled JSON that gets spread into a Prisma
 * `include`, so they decide the shape of the query. Left open, an
 * authenticated user could over-fetch any relation of a scanned asset or kit
 * (bookings, custody rows that bypass the custody-visibility redaction, the
 * creator's full `User` row), or force expensive nested queries. The parent row
 * is org-scoped, so this is not cross-tenant, but it is still an unbounded
 * query-shape injection.
 *
 * The sanitizer therefore keeps only:
 * - a top-level relation named in the per-model allowlist below, and
 * - inside it, only the SCALAR fields listed for that relation, as `true`.
 *
 * In a Prisma `select`, `relation: true` loads that whole related row, so a
 * "boolean values only" check is not enough: every selected key must be a
 * known scalar. A bare `relation: true` (which would load every scalar of the
 * relation) becomes a select of the allowlisted fields. Nested relations,
 * `include`, `where` and any unknown key are dropped.
 *
 * The scanner drawers render placement and kit membership from the
 * `assetLocations` / `assetKits` pivots, which `ASSET_INCLUDE` always selects,
 * so no drawer needs an extra include for them.
 *
 * @see {@link file://./scanner-includes.server.ts}
 * @see {@link file://./../routes/api+/get-scanned-barcode.$value.ts}
 * @see {@link file://./../routes/api+/get-scanned-item.$qrId.ts}
 */
import type { Prisma } from "@prisma/client";

/**
 * Maps an allowed top-level relation to the scalar columns a caller may select
 * on it. Every listed field must be a scalar column of the related model in
 * `packages/database/prisma/schema.prisma`, never a relation.
 */
type ScalarAllowlist = Readonly<Record<string, readonly string[]>>;

/** Scalar `Category` columns safe to show on a scanner row. */
const CATEGORY_FIELDS = ["id", "name", "color"] as const;

/** Scalar `Location` columns safe to show on a scanner row. */
const LOCATION_FIELDS = ["id", "name"] as const;

/**
 * Relations a caller may add to the scanned ASSET include. `Asset` reaches
 * kits and locations only through the `AssetKit` / `AssetLocation` pivots,
 * which `ASSET_INCLUDE` already selects, so `category` is the only direct
 * relation worth offering.
 */
const ASSET_EXTRA_INCLUDE_ALLOWLIST: ScalarAllowlist = {
  category: CATEGORY_FIELDS,
};

/** Relations a caller may add to the scanned KIT include. */
const KIT_EXTRA_INCLUDE_ALLOWLIST: ScalarAllowlist = {
  category: CATEGORY_FIELDS,
  location: LOCATION_FIELDS,
};

/** A sanitized relation entry: a flat select of allowlisted scalars. */
type SafeRelationSelect = { select: Record<string, true> };

/**
 * Narrows one relation value to a select of allowlisted scalar fields.
 *
 * @param value - The raw client value for the relation (`true` or `{ select }`)
 * @param fields - The scalar fields allowed on this relation
 * @returns A flat `{ select }` of allowlisted scalars, or `undefined` when the
 *   value has an unsupported shape or selects no allowlisted field
 */
function sanitizeRelation(
  value: unknown,
  fields: readonly string[]
): SafeRelationSelect | undefined {
  // `relation: true` loads every scalar of the relation, so narrow it to the
  // allowlist rather than passing it through.
  if (value === true) {
    return { select: Object.fromEntries(fields.map((f) => [f, true])) };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  // Only `{ select: {...} }` is accepted: `include`, `where`, `orderBy` and
  // any extra key alongside `select` reject the whole value.
  const keys = Object.keys(value);
  const select = (value as { select?: unknown }).select;
  if (
    keys.length !== 1 ||
    keys[0] !== "select" ||
    !select ||
    typeof select !== "object" ||
    Array.isArray(select)
  ) {
    return undefined;
  }

  // Keep only allowlisted scalar names set to exactly `true`. A relation name
  // here (even as `true`) would load the whole related row, so anything not
  // on the list is dropped.
  const picked: Record<string, true> = {};
  for (const [field, flag] of Object.entries(select)) {
    if (flag === true && fields.includes(field)) {
      picked[field] = true;
    }
  }

  return Object.keys(picked).length > 0 ? { select: picked } : undefined;
}

/**
 * Applies a per-relation scalar allowlist to a raw extra-include object.
 *
 * @param input - The parsed client JSON
 * @param allowlist - Allowed relations and their scalar fields
 * @returns The sanitized include, or `undefined` when nothing survives
 */
function sanitize(
  input: unknown,
  allowlist: ScalarAllowlist
): Record<string, SafeRelationSelect> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const out: Record<string, SafeRelationSelect> = {};
  for (const [key, raw] of Object.entries(input)) {
    // `Object.hasOwn` so a key like `toString` cannot reach a prototype value.
    if (!Object.hasOwn(allowlist, key)) continue;
    const value = sanitizeRelation(raw, allowlist[key]);
    if (value) out[key] = value;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Sanitizes a user-supplied `assetExtraInclude` down to allowlisted relations
 * with allowlisted scalar fields, before it is merged into a Prisma asset
 * `include`.
 *
 * @param input - The parsed `assetExtraInclude` query param
 * @returns A safe asset include fragment, or `undefined` when nothing survives
 */
export function sanitizeAssetExtraInclude(
  input: unknown
): Prisma.AssetInclude | undefined {
  return sanitize(input, ASSET_EXTRA_INCLUDE_ALLOWLIST) as
    | Prisma.AssetInclude
    | undefined;
}

/**
 * Sanitizes a user-supplied `kitExtraInclude` down to allowlisted relations
 * with allowlisted scalar fields, before it is merged into a Prisma kit
 * `include`.
 *
 * @param input - The parsed `kitExtraInclude` query param
 * @returns A safe kit include fragment, or `undefined` when nothing survives
 */
export function sanitizeKitExtraInclude(
  input: unknown
): Prisma.KitInclude | undefined {
  return sanitize(input, KIT_EXTRA_INCLUDE_ALLOWLIST) as
    | Prisma.KitInclude
    | undefined;
}
