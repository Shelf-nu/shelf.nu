import {
  type AssetType,
  type ConsumptionType,
  OrganizationRoles,
} from "@prisma/client";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ShelfError } from "~/utils/error";
import {
  type PermissionAction,
  type PermissionEntity,
} from "~/utils/permissions/permission.data";
import { validatePermission } from "~/utils/permissions/permission.validator.server";
import {
  assertCanUseBookings,
  canUseAudits,
  canUseBarcodes,
} from "~/utils/subscription.server";
import {
  computeCanSeeAllCustody,
  filterMobileCustodyListForViewer,
  viewerCanSeeLegacyCustody,
} from "./mobile-custody-visibility.server";
import { recordMobileActivity } from "./mobile-usage.server";

/**
 * Validates a Supabase JWT from the Authorization header and returns the
 * authenticated user's database record.
 *
 * Used exclusively by mobile API routes. The webapp's cookie-based session
 * middleware doesn't apply to mobile clients, so we validate the JWT directly.
 */
export async function requireMobileAuth(request: Request) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new ShelfError({
      cause: null,
      message: "Missing or invalid Authorization header",
      label: "Auth",
      status: 401,
    });
  }

  const token = authHeader.slice(7);

  // Validate the JWT with Supabase Admin
  const {
    data: { user: authUser },
    error,
  } = await getSupabaseAdmin().auth.getUser(token);

  if (error || !authUser) {
    throw new ShelfError({
      cause: error,
      message: "Invalid or expired token",
      label: "Auth",
      status: 401,
    });
  }

  if (!authUser.email) {
    throw new ShelfError({
      cause: null,
      message: "User account has no email address",
      label: "Auth",
      status: 400,
    });
  }

  // Get the database user record — exclude soft-deleted users
  const user = await db.user.findUnique({
    where: { email: authUser.email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
      onboarded: true,
      deletedAt: true,
      lastMobileActiveAt: true,
    },
  });

  if (!user || user.deletedAt) {
    throw new ShelfError({
      cause: null,
      message: "User not found in database",
      label: "Auth",
      status: 404,
    });
  }

  // Record companion-app usage for adoption metrics. requireMobileAuth is the
  // single chokepoint every mobile API route passes through (QR scanner
  // included), so recording here covers them all in one place. Debounced +
  // fire-and-forget — never blocks or breaks the request (see
  // mobile-usage.server.ts).
  recordMobileActivity(user.id, user.lastMobileActiveAt);

  // Strip internal-only fields from the returned object
  const {
    deletedAt: _deletedAt,
    lastMobileActiveAt: _lastMobileActiveAt,
    ...safeUser
  } = user;
  return { user: safeUser, authUser };
}

/**
 * Fetches organizations for a user, with their roles.
 */
export async function getUserOrganizations(userId: string) {
  const userOrgs = await db.userOrganization.findMany({
    where: { userId },
    select: {
      roles: true,
      organization: {
        select: {
          id: true,
          name: true,
          type: true,
          imageId: true,
          barcodesEnabled: true,
          auditsEnabled: true,
        },
      },
    },
  });

  // Serialize the *canonical* add-on capability (premium-aware), not the
  // raw DB flags, so the companion's client-side gating
  // (`currentOrg.auditsEnabled` / `.barcodesEnabled`) stays aligned with
  // the server gating, which now uses canUseAudits/canUseBarcodes. Without
  // this, non-premium/self-hosted deployments would allow the feature on
  // the API but hide it in the app.
  return userOrgs.map((uo) => ({
    ...uo.organization,
    barcodesEnabled: canUseBarcodes(uo.organization),
    auditsEnabled: canUseAudits(uo.organization),
    roles: uo.roles,
  }));
}

/**
 * Resolves the organizationId from the request and verifies
 * the user has access to it. Returns the organizationId.
 *
 * Mobile clients send orgId as a query param or x-shelf-organization header.
 */
export async function requireOrganizationAccess(
  request: Request,
  userId: string
): Promise<string> {
  const url = new URL(request.url);
  const orgId =
    url.searchParams.get("orgId") ||
    request.headers.get("x-shelf-organization");

  if (!orgId) {
    throw new ShelfError({
      cause: null,
      message:
        "Missing organization ID. Pass orgId as query param or x-shelf-organization header.",
      label: "Auth",
      status: 400,
    });
  }

  const membership = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    select: { id: true },
  });

  if (!membership) {
    throw new ShelfError({
      cause: null,
      message: "You don't have access to this organization",
      label: "Auth",
      status: 403,
    });
  }

  return orgId;
}

/**
 * Enforces RBAC permission checks for mobile API routes.
 *
 * Uses the same Role2PermissionMap as the webapp to ensure mobile
 * and web have identical authorization rules.
 */
export async function requireMobilePermission({
  userId,
  organizationId,
  entity,
  action,
}: {
  userId: string;
  organizationId: string;
  entity: PermissionEntity;
  action: PermissionAction;
}) {
  await validatePermission({
    userId,
    organizationId,
    entity,
    action,
  });
}

/**
 * Fetches the user's role and org capability flags (barcodes, audits) for
 * a given organization. `canUseAudits`/`canUseBarcodes` reuse the canonical
 * subscription.server predicates so mobile matches webapp gating exactly.
 *
 * Also returns `canSeeAllCustody` — the mobile twin of the flag the web's
 * `requirePermission` returns (roles.server.ts:113-122): ADMIN/OWNER always
 * see all custody; SELF_SERVICE/BASE only when the matching org override
 * (`selfServiceCanSeeCustody` / `baseUserCanSeeCustody`) is enabled.
 *
 * Used by mobile routes that call service layer functions requiring
 * `getAssetIndexSettings` (e.g. bulkAssignCustody, bulkReleaseCustody) and
 * by routes that must gate custody visibility server-side.
 */
export async function getMobileUserContext(
  userId: string,
  organizationId: string
): Promise<{
  role: OrganizationRoles;
  canUseBarcodes: boolean;
  canUseAudits: boolean;
  canSeeAllCustody: boolean;
}> {
  const userOrg = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: {
      roles: true,
      organization: {
        select: {
          barcodesEnabled: true,
          auditsEnabled: true,
          // why: custody visibility is permission-gated per-org (web parity,
          // see mobile-custody-visibility.server.ts); resolving the overrides
          // here keeps it one query alongside the role.
          selfServiceCanSeeCustody: true,
          baseUserCanSeeCustody: true,
        },
      },
    },
  });

  if (!userOrg) {
    throw new ShelfError({
      cause: null,
      message: "User organization membership not found",
      label: "Auth",
      status: 403,
    });
  }

  // why: roles is an array but we always operate on the first role; mirror
  // the convention used in roles.server.ts and invite/service.server.ts so
  // an empty array doesn't surface as `undefined` to downstream callers.
  const role = userOrg.roles[0] ?? OrganizationRoles.BASE;

  return {
    role,
    canUseBarcodes: canUseBarcodes(userOrg.organization),
    canUseAudits: canUseAudits(userOrg.organization),
    canSeeAllCustody: computeCanSeeAllCustody({
      role,
      organization: userOrg.organization,
    }),
  };
}

/**
 * Asserts the organization may use bookings — a TEAM-plan feature. Mobile twin
 * of the web route-layer `assertCanUseBookings` gate.
 *
 * `requireOrganizationAccess` only proves membership and returns the org id, so
 * this loads the org `type` before asserting. Every mobile booking endpoint
 * (create/update/reserve/remove + checkout/checkin/partial) should call this so
 * personal workspaces can't use bookings on mobile, matching web.
 *
 * @param organizationId - The caller's active organization id.
 * @throws {ShelfError} 404 if the org is missing; 403 for personal workspaces.
 */
export async function assertMobileCanUseBookings(organizationId: string) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { type: true },
  });

  if (!organization) {
    throw new ShelfError({
      cause: null,
      message: "Organization not found.",
      label: "Auth",
      status: 404,
    });
  }

  assertCanUseBookings(organization);
}

/**
 * Shared Prisma select shape for asset data returned by mobile scanner endpoints.
 * Used by both QR and barcode resolution routes for consistent responses.
 *
 * NOTE: Post-Phase-4a/4b the `Asset` model no longer carries direct `kitId` or
 * `location` columns — kit linkage now lives on the `AssetKit` pivot
 * (`assetKits`) and location on the `AssetLocation` pivot (`assetLocations`).
 * Custody also became 1:many (`Custody[]`). The companion app currently in
 * App Store review (since 2026-05-20) consumes the legacy flat shape
 * (`asset.kit`, `asset.kitId`, `asset.location`, `asset.custody` as a single
 * object). To keep that live build working without a forced update, mobile
 * routes fetch this select and then call `shapeMobileAssetResponse` to
 * flatten the pivot rows into the legacy shape — mirroring the
 * `MOBILE_KIT_SELECT` + `shapeMobileKitResponse` pair below.
 */
export const MOBILE_ASSET_SELECT = {
  id: true,
  title: true,
  status: true,
  mainImage: true,
  // why: powers the scan-to-booking "not available to book" blocker.
  availableToBook: true,
  // Quantity fields (additive). INDIVIDUAL assets carry `type: "INDIVIDUAL"`
  // and null quantity columns; QUANTITY_TRACKED assets surface the totals the
  // companion will use to DISPLAY quantity. The shaper passes these through
  // verbatim alongside the existing legacy fields.
  type: true,
  quantity: true,
  minQuantity: true,
  unitOfMeasure: true,
  consumptionType: true,
  category: { select: { name: true } },
  // Kit linkage now lives on the `AssetKit` pivot. shapeMobileAssetResponse
  // flattens `assetKits[0]` to top-level `kit` + `kitId` so the in-App-Store
  // companion's `asset.kit` / `asset.kitId` reads still work.
  assetKits: {
    select: { kit: { select: { id: true, name: true } } },
  },
  // Location ditto via the `AssetLocation` pivot — flattened to top-level
  // `location` by the shaper.
  assetLocations: {
    select: { location: { select: { id: true, name: true } } },
  },
  // Custody is now 1:many; the shaper flattens `custody[0]` so companion's
  // `asset.custody?.custodian` single-object read still works. We also select
  // `quantity` so the shaper can surface the many-aware `custodyList` (the
  // legacy single `custody` stays in place too). Ordered by `createdAt` so
  // both the flattened `custody[0]` and `custodyList` are deterministic
  // (the relation is otherwise unordered).
  custody: {
    orderBy: { createdAt: "asc" },
    select: {
      quantity: true,
      // why: `kitCustodyId` discriminates operator-assigned rows (null) from
      // kit-allocated rows — the shaper sums the operator-only portion into
      // `releasableQuantity` (kit-allocated units are released via the kit).
      kitCustodyId: true,
      // why: `custodian.userId` lets the companion recognize the caller's own
      // custody row (self-service users may only release their own units).
      // Web parity: CustodyCard already ships custodianUserId to the client.
      custodian: { select: { id: true, name: true, userId: true } },
    },
  },
} as const;

/**
 * Shared Prisma select shape for kit data returned by mobile scanner
 * endpoints (QR/barcode resolution). The per-asset statuses power the
 * scanner's kit batch blockers ("kit has assets in custody"), mirroring the
 * web scanner drawers.
 *
 * NOTE: `Kit` no longer exposes a direct `assets` relation — it is now joined
 * via the `AssetKit` pivot (`assetKits`). We still need to surface the
 * per-asset status/availableToBook to the companion app in the legacy flat
 * shape (`kit.assets: {id,status,availableToBook}[]` + `kit._count.assets`)
 * so the existing mobile clients in the App Store don't break. Mobile
 * endpoints fetch this select shape and then call
 * `shapeMobileKitResponse` to flatten the pivot rows.
 */
export const MOBILE_KIT_SELECT = {
  id: true,
  name: true,
  status: true,
  image: true,
  _count: { select: { assetKits: true } },
  // why: per-asset status powers the "kit has assets in custody" blocker;
  // availableToBook powers the scan-to-booking "kit has unavailable assets"
  // blocker — both mirror the web scanner drawers.
  assetKits: {
    select: {
      asset: { select: { id: true, status: true, availableToBook: true } },
    },
  },
} as const;

/**
 * Shape returned to mobile clients for a scanned kit. Preserves the legacy
 * flat `assets` + `_count.assets` contract so the companion app continues
 * to work unchanged after the `Kit.assets` → `Kit.assetKits` migration.
 */
export type MobileKitResponse = {
  id: string;
  name: string;
  status: string;
  image: string | null;
  _count: { assets: number };
  assets: Array<{
    id: string;
    status: string;
    availableToBook: boolean;
  }>;
};

/**
 * Flattens a kit row fetched with `MOBILE_KIT_SELECT` (which uses the
 * `assetKits` pivot) into the legacy `{ assets, _count: { assets } }` shape
 * expected by the companion app's scanner. Returns `null` if the input is
 * `null` so callers can pass through directly.
 *
 * @param kit Kit row selected via `MOBILE_KIT_SELECT`, or `null`
 * @returns The legacy mobile response shape, or `null`
 */
export function shapeMobileKitResponse(
  kit: {
    id: string;
    name: string;
    status: string;
    image: string | null;
    _count: { assetKits: number };
    assetKits: Array<{
      asset: { id: string; status: string; availableToBook: boolean };
    }>;
  } | null
): MobileKitResponse | null {
  if (!kit) return null;
  return {
    id: kit.id,
    name: kit.name,
    status: kit.status,
    image: kit.image,
    _count: { assets: kit._count.assetKits },
    assets: kit.assetKits.map((ak) => ak.asset),
  };
}

/**
 * Shape returned to mobile clients for a single asset. Preserves the legacy
 * flat contract — top-level `kit` / `kitId` / `location` / `custody` (as a
 * single-or-null object) — so the companion app currently in App Store review
 * (since 2026-05-20) keeps working unchanged after the Phase-4a/4b migrations
 * that moved kit/location onto pivots and turned custody into a 1:many
 * relation on `Asset`.
 */
export type MobileAssetResponse = {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  availableToBook: boolean;
  category: { name: string } | null;
  kitId: string | null;
  kit: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  // Legacy single custody. `custodian.userId` is additive (nullable — NRM
  // custodians have no linked auth user); web's CustodyCard ships it too.
  custody: {
    custodian: { id: string; name: string; userId: string | null };
  } | null;
  // Quantity fields (additive). Surfaced so the companion can DISPLAY
  // quantity data; the existing legacy fields above are unchanged.
  type: AssetType;
  quantity: number | null;
  minQuantity: number | null;
  unitOfMeasure: string | null;
  consumptionType: ConsumptionType | null;
  // Many-aware custody list. `custody` (above) keeps the legacy single
  // object for the in-App-Store build; `custodyList` carries every row with
  // its quantity for QUANTITY_TRACKED assets that may have multiple holders.
  // `custodian.userId` (nullable — NRM custodians have none) lets the app
  // recognize the caller's own row; `releasableQuantity` is the operator-
  // assigned portion (kit-allocated units release via the kit's custody).
  custodyList: Array<{
    custodian: { id: string; name: string; userId: string | null };
    quantity: number;
    releasableQuantity: number;
  }>;
};

/**
 * Flattens an asset row fetched with `MOBILE_ASSET_SELECT` (which surfaces the
 * `assetKits`, `assetLocations`, and 1:many `custody` relations as arrays)
 * into the legacy flat shape (`kit`, `kitId`, `location`, single-or-null
 * `custody`) expected by the companion app's scanner / list / detail routes.
 *
 * Mirrors `shapeMobileKitResponse` above — same JSDoc style, same null
 * semantics, same flatten-the-pivot pattern. The kit/location/custody
 * flattening picks the first row from each pivot/relation: INDIVIDUAL assets
 * are capped at one row per pivot by DB triggers, so this is lossless for the
 * current companion contract. QUANTITY_TRACKED assets (Phase 4a+) may have
 * multiple rows, but they're out of scope for the in-review companion build
 * (see plan: Phase 4d will expose the richer pivot data after companion
 * ships QT support).
 *
 * The input type is hand-mirrored from `MOBILE_ASSET_SELECT` (not derived via
 * `Prisma.AssetGetPayload`) to match the local convention established by
 * `shapeMobileKitResponse` and to avoid Prisma's deep-generic recursion
 * warnings on selects that nest pivot relations.
 *
 * @param asset Asset row selected via `MOBILE_ASSET_SELECT`
 * @returns The legacy flat mobile response shape
 */
export function shapeMobileAssetResponse(asset: {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  availableToBook: boolean;
  category: { name: string } | null;
  type: AssetType;
  quantity: number | null;
  minQuantity: number | null;
  unitOfMeasure: string | null;
  consumptionType: ConsumptionType | null;
  assetKits: Array<{ kit: { id: string; name: string } }>;
  assetLocations: Array<{ location: { id: string; name: string } }>;
  custody: Array<{
    quantity: number;
    kitCustodyId: string | null;
    custodian: { id: string; name: string; userId: string | null };
  }>;
}): MobileAssetResponse {
  const { assetKits, assetLocations, custody, ...rest } = asset;
  const kit = assetKits[0]?.kit ?? null;
  // Aggregate custody rows by custodian so a holder with more than one row on
  // the same asset (e.g. a kit-driven row plus a standalone row) shows once
  // with their summed quantity rather than duplicated. Insertion order follows
  // the `createdAt`-ordered select, so the list stays deterministic.
  // `releasableQuantity` sums only operator-assigned rows (kitCustodyId null);
  // kit-allocated units are only released by releasing the kit's custody.
  const custodyList: MobileAssetResponse["custodyList"] = [];
  const custodyIndexById = new Map<string, number>();
  for (const c of custody) {
    const releasable = c.kitCustodyId === null ? c.quantity : 0;
    const existingIndex = custodyIndexById.get(c.custodian.id);
    if (existingIndex === undefined) {
      custodyIndexById.set(c.custodian.id, custodyList.length);
      custodyList.push({
        custodian: c.custodian,
        quantity: c.quantity,
        releasableQuantity: releasable,
      });
    } else {
      custodyList[existingIndex].quantity += c.quantity;
      custodyList[existingIndex].releasableQuantity += releasable;
    }
  }
  return {
    // `...rest` carries the new scalar quantity fields (type, quantity,
    // minQuantity, unitOfMeasure, consumptionType) through verbatim.
    ...rest,
    kitId: kit?.id ?? null,
    kit,
    location: assetLocations[0]?.location ?? null,
    // Legacy single-or-null custody for the in-App-Store build. `userId` is
    // additive (web parity: CustodyCard ships custodianUserId too).
    custody: custody[0] ? { custodian: custody[0].custodian } : null,
    // Many-aware custody list (additive) — every holder + their summed quantity.
    custodyList,
  };
}

/**
 * `MobileAssetResponse` plus the custody-visibility metadata added by
 * {@link getMobileAssetForViewer}: `custodyListOthersCount` is the number of
 * holders hidden from the viewer (0 when the viewer can see all custody), so
 * the companion can render "+N others" — mirroring the web's
 * `QuantityCustodyList` hidden-count (quantity-custody-list.tsx:126).
 */
export type MobileAssetForViewer = MobileAssetResponse & {
  custodyListOthersCount: number;
};

/**
 * Fetches an asset and shapes it for a SPECIFIC mobile viewer: the standard
 * `MOBILE_ASSET_SELECT` + `shapeMobileAssetResponse` pair, with the custody
 * fields filtered by the web's custody-visibility rules (see
 * mobile-custody-visibility.server.ts) so viewers without custody-view
 * permission only receive their own custody entries.
 *
 * Used by the quantity-custody action endpoints to return the refreshed
 * asset in the success envelope, saving the app a second round trip.
 *
 * @param args.assetId - The asset to fetch (org-scoped)
 * @param args.organizationId - The caller's active organization
 * @param args.viewerUserId - The authenticated caller's user id
 * @param args.canSeeAllCustody - From {@link getMobileUserContext}
 * @returns The viewer-shaped asset, or null when not found in the org
 */
export async function getMobileAssetForViewer({
  assetId,
  organizationId,
  viewerUserId,
  canSeeAllCustody,
}: {
  assetId: string;
  organizationId: string;
  viewerUserId: string;
  canSeeAllCustody: boolean;
}): Promise<MobileAssetForViewer | null> {
  const asset = await db.asset.findUnique({
    // why: inline-scope to org so cross-org probes read nothing — matches
    // the pattern used by every other mobile route.
    where: { id: assetId, organizationId },
    // MOBILE_ASSET_SELECT's custody select already carries `custodian.userId`
    // (own-row detection; web parity) and `kitCustodyId` (releasableQuantity).
    // Shipping userId on VISIBLE rows is deliberate — privacy is enforced by
    // the row-level filter below, which removes rows the viewer may not see.
    select: MOBILE_ASSET_SELECT,
  });

  if (!asset) return null;

  const shaped = shapeMobileAssetResponse(asset);

  const { custodyList, custodyListOthersCount } =
    filterMobileCustodyListForViewer({
      custodyList: shaped.custodyList,
      custodyRows: asset.custody,
      viewerUserId,
      canSeeAllCustody,
    });

  // Legacy single `custody` follows the web's specific-custody rule (see
  // viewerCanSeeLegacyCustody): hidden unless the viewer can see all custody
  // or IS the (primary) custodian.
  const primaryCustody = asset.custody[0] ?? null;
  const custody =
    primaryCustody &&
    viewerCanSeeLegacyCustody({
      custodianUserId: primaryCustody.custodian.userId,
      viewerUserId,
      canSeeAllCustody,
    })
      ? shaped.custody
      : null;

  return { ...shaped, custody, custodyList, custodyListOthersCount };
}
