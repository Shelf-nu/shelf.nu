import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import type { BookingPoolAvailabilityRow } from "~/modules/asset/availability.server";
import { getBookingPoolAvailability } from "~/modules/asset/availability.server";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import {
  resolveDisplayCode,
  labelForPreference,
} from "~/modules/barcode/display";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * Page size this endpoint requests when the client doesn't specify one.
 * 100 is the ceiling `getPaginatedAndFilterableAssets` accepts (anything above
 * it silently falls back to 20), so this is the most a paginationless client
 * can be given in a single response.
 */
const MOBILE_PICKER_MAX_PAGE_SIZE = 100;

/**
 * Wire shape of one asset row in this endpoint's response — the mobile twin of
 * the companion's `AvailableAsset` type (`apps/companion/lib/api/types.ts`).
 * Exported so the wire-contract test
 * (`apps/webapp/test/mobile/booking-picker-quantity-contract.test.ts`) can
 * assert both sides stay in sync at compile time. Keep the two in lockstep:
 * every field added here must land on the companion type as OPTIONAL (live
 * app versions must tolerate servers that predate the field, and vice versa).
 */
export type MobileAvailableAssetRow = {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  /** Date server-side; serializes to an ISO string on the wire. */
  mainImageExpiration: Date | null;
  thumbnailImage: string | null;
  kitId: string | null;
  displayCode: { value: string; label: string } | null;
  /**
   * Quantity fields (additive, quantity-trust work 2026-07). Per
   * `.claude/rules/quantity-semantics-per-surface.md`, this row is a booking
   * PICKER row, so:
   *  - `quantity` = WORKSPACE STOCK (`Asset.quantity`) — the "of N" part of
   *    the row's "X of N available" meta line. `null` for INDIVIDUAL assets.
   *  - `availableQuantity` = clamped (display-safe, never negative) bookable
   *    headroom in THIS booking's window, from the canonical booking-pool
   *    module with the manage-assets picker flag set. `null` for INDIVIDUAL
   *    assets (their availability is already enforced by the list's
   *    where-clause filter; only QUANTITY_TRACKED rows are always shown and
   *    need per-unit headroom).
   */
  quantity: number | null;
  unitOfMeasure: string | null;
  availableQuantity: number | null;
};

/**
 * GET /api/mobile/bookings/available-assets
 *
 * Availability-aware asset picker for the booking create/edit flow — the mobile
 * twin of the web "manage assets" drawer. Passes through to the shared
 * `getPaginatedAndFilterableAssets` service, which builds the date-overlap
 * availability where-clause (excludes assets in custody, in maintenance, or
 * already reserved/checked-out for the requested window). No new query logic.
 *
 * The availability filter requires a date window: pass `bookingFrom`, `bookingTo`
 * and `hideUnavailable=true`. `unhideAssetsBookigIds=<bookingId>` keeps the
 * current booking's own assets visible when editing. The shared service throws a
 * 400 if `hideUnavailable` is set without both dates.
 *
 * Unlike the simple `/api/mobile/assets` list, this endpoint is purpose-built for
 * bookings, so the picker never offers an asset the server would later reject at
 * reserve/checkout.
 *
 * Query (forwarded to the shared service):
 *   ?orgId & bookingFrom & bookingTo & hideUnavailable=true
 *   & unhideAssetsBookigIds? & s? (search) & page? & per_page? & status?
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.manage-assets.tsx} web twin
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Defence in depth: this is the picker for booking asset selection, so it
    // gates on the same permission as its web twin (manage-assets) and the
    // sibling mobile booking routes — a role that cannot edit a booking has no
    // business enumerating its bookable inventory.
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    // Bookings are a TEAM-tier (premium) feature — gate this booking-availability
    // read like the mutation routes so PERSONAL workspaces can't query it.
    await assertMobileCanUseBookings(organizationId);

    // The web booking-asset picker (manage-assets) does NOT scope by
    // self-service custody — any bookable asset is selectable, and the
    // self-service restriction is enforced on the mutation, not the read.
    /**
     * The companion's picker has NO pagination UI — `add-assets.tsx` renders a
     * FlatList with no `onEndReached` and no page state, so whatever this one
     * response contains is the entire set the operator can ever browse. The
     * client never sends a `per_page`, so the size comes from
     * `updateCookieWithPerPage`, whose default is 20 for a request with no
     * cookie — and mobile never sends one. Every live 1.1.0 install was
     * therefore capped at 20 assets: a workspace holding exactly 20
     * tablecloths could reach nothing else except via search.
     *
     * Until the app ships real infinite scroll (which needs a store release,
     * and there is no OTA channel), request the service's maximum page size
     * whenever the client didn't ask for a specific one. This reaches existing
     * installs with a plain webapp deploy. Rebuilding the params and passing
     * them as `filters` keeps every other query param (booking window,
     * hideUnavailable, search) intact while overriding only the page size.
     */
    const pickerParams = new URL(request.url).searchParams;
    if (!pickerParams.get("per_page")) {
      pickerParams.set("per_page", String(MOBILE_PICKER_MAX_PAGE_SIZE));
    }

    const { assets, page, perPage, totalAssets, totalPages } =
      await getPaginatedAndFilterableAssets({
        request,
        organizationId,
        filters: pickerParams.toString(),
      });

    // Resolve the workspace's display code (QR Code ID by default, or a SAM ID
    // / barcode per the org's preference) for each asset so the mobile picker
    // can show it on every row — the operator can then match a physical label
    // by eye and toggle the exact unit (web parity: `resolveDisplayCode` +
    // `<AssetCodeBadge>` render this on every web asset row). Narrow, decoupled
    // lookup of the code relations for just this page of ids (mirrors the web
    // fulfil route's supplementary select) so it doesn't depend on the shared
    // service's include shape.
    /**
     * Booking-pool availability for the QUANTITY_TRACKED rows on this page.
     * The list's `hideUnavailable` where-clause always shows QT assets
     * (partial availability can't be expressed as a row filter), so without
     * this the picker offers a fully-allocated QT asset with no signal —
     * the operator only learns at add/reserve time. Flag set mirrors the web
     * manage-assets picker verbatim (see the flag table in
     * `~/modules/asset/availability.server`): exclude the booking being
     * edited, window-scoped to the booking dates, custodyScope "all",
     * kit slices subtract, dispositionAware false (behavior-parity with the
     * web picker; flipping is the documented follow-up).
     */
    const qtyAssetIds = assets
      .filter((a) => a.type === "QUANTITY_TRACKED")
      .map((a) => a.id);
    /**
     * The booking being edited — its own reservations must not compete with
     * itself. The web param is plural (the drawer can unhide several), but
     * this endpoint's only client (the companion picker) sends exactly one:
     * the booking it is editing. A foreign-org id here is harmless: it is
     * only used as a `not:` exclusion inside an org-scoped reservation query,
     * so it can neither read nor leak anything (the pool fetch itself is
     * org-scoped per `.claude/rules/org-scope-user-supplied-ids.md`).
     */
    const excludeBookingId = pickerParams.getAll("unhideAssetsBookigIds").at(0);
    const bookingFrom = new Date(pickerParams.get("bookingFrom") ?? "");
    const bookingTo = new Date(pickerParams.get("bookingTo") ?? "");
    /** Window only when both dates parse — dateless falls back to global pool. */
    const clientWindow =
      !Number.isNaN(bookingFrom.getTime()) && !Number.isNaN(bookingTo.getTime())
        ? { from: bookingFrom, to: bookingTo }
        : null;

    /**
     * Prefer the DB booking's dates over the client-supplied query params
     * for the availability window. `bookingFrom`/`bookingTo` are
     * client-asserted and can lag DB truth (booking rescheduled on the web
     * between companion screens) or be arbitrary — the working siblings
     * (manage-assets picker, scanner picker-meta) both read
     * `booking.from/to` server-side. Org-scoped lookup per
     * `.claude/rules/org-scope-user-supplied-ids.md`; a foreign-org or
     * unknown id simply yields no row and we keep the client fallback
     * (which the where-clause filter is also built from — display-only
     * divergence, the server still enforces at add time). Drafts can lack
     * dates, hence the null checks.
     */
    const resolveWindow = async (): Promise<typeof clientWindow> => {
      if (!excludeBookingId) return clientWindow;
      const bookingRow = await db.booking.findFirst({
        where: { id: excludeBookingId, organizationId },
        select: { from: true, to: true },
      });
      return bookingRow?.from && bookingRow?.to
        ? { from: bookingRow.from, to: bookingRow.to }
        : clientWindow;
    };

    const assetIds = assets.map((a) => a.id);
    const [org, codeRows, poolByAsset] = await Promise.all([
      db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { qrIdDisplayPreference: true, barcodesEnabled: true },
      }),
      assetIds.length > 0
        ? db.asset.findMany({
            where: { id: { in: assetIds }, organizationId },
            select: {
              id: true,
              sequentialId: true,
              preferredBarcodeId: true,
              qrCodes: { select: { id: true } },
              barcodes: { select: { id: true, type: true, value: true } },
            },
          })
        : Promise.resolve([]),
      qtyAssetIds.length > 0
        ? resolveWindow().then((window) =>
            getBookingPoolAvailability({
              assetIds: qtyAssetIds,
              organizationId,
              excludeBookingId,
              window,
              custodyScope: "all",
              includeKitSlices: true,
              dispositionAware: false,
            })
          )
        : Promise.resolve(new Map<string, BookingPoolAvailabilityRow>()),
    ]);
    const codeByAssetId = new Map(codeRows.map((r) => [r.id, r]));

    // Trim to a mobile-friendly payload (mirrors `/api/mobile/assets`).
    return data({
      assets: assets.map((asset): MobileAvailableAssetRow => {
        const codeEntity = codeByAssetId.get(asset.id);
        const resolved = codeEntity
          ? resolveDisplayCode({ entity: codeEntity, organization: org })
          : null;
        return {
          id: asset.id,
          title: asset.title,
          status: asset.status,
          mainImage: asset.mainImage,
          mainImageExpiration: asset.mainImageExpiration,
          thumbnailImage: asset.thumbnailImage,
          // Kit linkage moved to the AssetKit pivot (quantities restructure);
          // the pivot row's `kitId` FK is the legacy single-kit id the companion
          // contract expects.
          kitId: asset.assetKits?.[0]?.kitId ?? null,
          // The label the operator reads off the physical tag (e.g.
          // "QR Code ID": "w7l4c42u01"). Null when the asset has no resolvable
          // code (older row / partial data) — the picker then just omits it.
          displayCode:
            resolved && resolved.value
              ? {
                  value: resolved.value,
                  label: labelForPreference(resolved.type),
                }
              : null,
          // Quantity fields — see MobileAvailableAssetRow JSDoc for the
          // per-field semantics (workspace stock vs windowed headroom).
          quantity: asset.quantity ?? null,
          unitOfMeasure: asset.unitOfMeasure ?? null,
          availableQuantity:
            asset.type === "QUANTITY_TRACKED"
              ? // `available` (clamped at 0) on purpose: the mobile row is
                // display-only, and a negative pool would render as nonsense.
                // Rows can't be missing from the map — `qtyAssetIds` came from
                // the same org-scoped page — but fall back to 0 (not bookable)
                // rather than lying with the workspace stock.
                poolByAsset.get(asset.id)?.available ?? 0
              : null,
        };
      }),
      page,
      perPage,
      totalCount: totalAssets,
      totalPages,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
