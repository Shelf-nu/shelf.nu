/**
 * Sanitizer for the `assetExtraInclude` / `kitExtraInclude` query params on the
 * scanned-item lookup endpoints.
 *
 * Those params are user-controlled JSON that gets spread into a Prisma
 * `include`. Unsanitized, an authenticated user could shape the query to
 * over-fetch arbitrary relations (e.g. `organization`, `bookings`,
 * `custody.custodian`, deeply nested `include`s) on a scanned asset/kit, or
 * cause expensive nested queries (CWE-94 / overfetch / query DoS). The parent
 * row is already org-scoped, so this is not cross-tenant — but it is still an
 * unbounded query-shape injection.
 *
 * Fix: allow only the top-level relation keys the scanner drawers legitimately
 * request, and only the shapes they actually send (`true` or a flat
 * `{ select }`). Any other key, or a value containing `include` / `where` /
 * arbitrary nesting, is dropped.
 *
 * @see {@link file://./../routes/api+/get-scanned-barcode.$value.ts}
 * @see {@link file://./../routes/api+/get-scanned-item.$qrId.ts}
 */
import type { Prisma } from "@prisma/client";

/** Top-level relation keys the scanner drawers may add to the asset include. */
const ALLOWED_ASSET_EXTRA_INCLUDE = new Set(["kit", "location", "category"]);
/** Top-level relation keys allowed on the kit include (conservative, low-risk
 * same-org relations; no caller requires more today). */
const ALLOWED_KIT_EXTRA_INCLUDE = new Set(["category", "location"]);

/**
 * Allow only the shapes the drawers send: `true`, or a *strictly flat*
 * `{ select: { <field>: boolean, ... } }` (scalar field selection only).
 *
 * Reject `{ include: ... }`, any non-boolean value inside `select` (which
 * would let an attacker traverse relations via nested select, e.g.
 * `{ select: { assets: { select: { bookings: true } } } }`), and anything
 * else — so relation traversal / deep nesting cannot be injected.
 */
function sanitizeValue(
  value: unknown
): true | { select: Record<string, boolean> } | undefined {
  if (value === true) return true;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value as Record<string, unknown>);
    const select = (value as { select?: unknown }).select;
    if (
      keys.length === 1 &&
      keys[0] === "select" &&
      select &&
      typeof select === "object" &&
      !Array.isArray(select)
    ) {
      // SECURITY: every value in `select` must be a boolean (scalar field
      // pick). Nested objects/arrays here would re-enable relation traversal
      // under an allowlisted top-level key — the exact bypass the sanitizer
      // exists to prevent.
      const selectObj = select as Record<string, unknown>;
      const isFlat = Object.values(selectObj).every(
        (v) => typeof v === "boolean"
      );
      if (!isFlat) return undefined;
      return { select: selectObj as Record<string, boolean> };
    }
  }
  return undefined;
}

function sanitize(input: unknown, allowed: Set<string>) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const out: Record<string, true | { select: object }> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    const value = sanitizeValue(raw);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Sanitizes a user-supplied `assetExtraInclude` down to a safe allowlisted
 * subset before it is merged into a Prisma asset `include`.
 */
export function sanitizeAssetExtraInclude(
  input: unknown
): Prisma.AssetInclude | undefined {
  return sanitize(input, ALLOWED_ASSET_EXTRA_INCLUDE) as
    | Prisma.AssetInclude
    | undefined;
}

/**
 * Sanitizes a user-supplied `kitExtraInclude` down to a safe allowlisted
 * subset before it is merged into a Prisma kit `include`.
 */
export function sanitizeKitExtraInclude(
  input: unknown
): Prisma.KitInclude | undefined {
  return sanitize(input, ALLOWED_KIT_EXTRA_INCLUDE) as
    | Prisma.KitInclude
    | undefined;
}
