import { AssetType, OrganizationRoles } from "@prisma/client";
import { useSetAtom } from "jotai";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "react-router";
import { data, useLoaderData, useNavigation } from "react-router";
import { z } from "zod";
import type { BookingExpectedAsset } from "~/atoms/qr-scanner";
import { addScannedItemAtom } from "~/atoms/qr-scanner";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { CodeScanner } from "~/components/scanner/code-scanner";
import PartialCheckoutDrawer from "~/components/scanner/drawer/uses/partial-checkout-drawer";
import { db } from "~/database/db.server";
import { useBookingCheckinSessionInitialization } from "~/hooks/use-booking-checkin-session-initialization";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import {
  checkoutAssets,
  computeBookingAssetRemainingToCheckOut,
  computeBookingAssetSliceRemainingToCheckOut,
  getBooking,
  getDetailedPartialCheckoutData,
  getPartiallyCheckedInAssetIds,
} from "~/modules/booking/service.server";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { canUserManageBookingAssets } from "~/utils/bookings";

import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { assertIsPost, payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: scannerCss },
];

/**
 * Checkout-eligibility guard shared by the loader and the action.
 *
 * Self-service users may check out only their OWN (custodian) booking and only
 * in a checkout-eligible status; everyone else is gated by
 * `canUserManageBookingAssets`. This MUST run in the action too, not just the
 * loader: a Remix action can be POSTed directly (bypassing the loader), and
 * `PermissionAction.checkout` alone is granted to SELF_SERVICE — so without it a
 * self-service user could check out assets in another user's booking in the
 * same organization.
 *
 * @throws {ShelfError} when the caller may not check out this booking
 * @returns the loaded booking (so the loader can reuse it without re-fetching)
 */
async function assertUserCanCheckoutBooking({
  bookingId,
  organizationId,
  userId,
  role,
  userOrganizations,
  request,
}: {
  bookingId: string;
  organizationId: string;
  userId: string;
  role: OrganizationRoles;
  userOrganizations: Awaited<
    ReturnType<typeof requirePermission>
  >["userOrganizations"];
  request: Request;
}) {
  const isSelfService = role === OrganizationRoles.SELF_SERVICE;

  const booking = await getBooking({
    id: bookingId,
    organizationId,
    userOrganizations,
    request,
  });

  // Self-service users are allowed when the booking is reservable/ongoing/overdue
  // AND they are the custodian. The generic canUserManageBookingAssets blocks
  // self-service on non-draft bookings, but that restriction is for
  // adding/removing assets, not for checking out.
  const isCheckoutEligible =
    booking.status === "RESERVED" ||
    booking.status === "ONGOING" ||
    booking.status === "OVERDUE";
  const isCustodian = booking.custodianUserId === userId;
  const canCheckout =
    isSelfService && isCheckoutEligible && isCustodian
      ? true
      : canUserManageBookingAssets(booking, isSelfService);

  if (!canCheckout) {
    throw new ShelfError({
      cause: null,
      message:
        "You cannot check out assets for this booking at the moment. The booking may not be reservable/ongoing or you may not have permission to manage its assets.",
      label: "Booking",
      shouldBeCaptured: false,
    });
  }

  return booking;
}

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, role, userOrganizations } = await requirePermission(
      {
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.checkout,
      }
    );

    const booking = await assertUserCanCheckoutBooking({
      bookingId,
      organizationId,
      userId,
      role,
      userOrganizations,
      request,
    });

    // Always fetch partial check-out data for scanner validation. We need this
    // to detect blockers for already-checked-out assets/kits and to feed the
    // drawer's asset-scoped "remaining to check out" count.
    const { checkedOutAssetIds } = await getDetailedPartialCheckoutData({
      bookingId: booking.id,
      organizationId,
    });

    // Assets already returned via partial check-in are AVAILABLE again but are
    // DONE for this booking — they must be excluded from the "remaining to
    // check out" count and from checkout eligibility, otherwise the scanner
    // denominator over-counts (e.g. 16 booked, 2 returned would wrongly show
    // /16 instead of /14).
    const checkedInAssetIds = await getPartiallyCheckedInAssetIds(booking.id);

    // Per-asset remaining-to-checkout for QUANTITY_TRACKED assets on this
    // booking. Folds across all slices (kit + standalone) so the drawer can
    // gate eligibility on `remaining > 0` instead of "appears in any prior
    // PartialBookingCheckout record". Empty map when there are no qty-tracked
    // assets — INDIVIDUAL flow is unchanged (those still reject on second scan
    // via `checkedOutAssetIds`).
    const qtyAssetIds = booking.bookingAssets
      .filter((ba) => ba.asset?.type === AssetType.QUANTITY_TRACKED)
      .map((ba) => ba.assetId);
    const uniqueQtyAssetIds = [...new Set(qtyAssetIds)];
    const remainingToCheckOutByAsset: Record<string, number> = {};
    for (const assetId of uniqueQtyAssetIds) {
      remainingToCheckOutByAsset[assetId] =
        await computeBookingAssetRemainingToCheckOut(db, booking.id, assetId);
    }

    /**
     * Per-slice (bookingAssetId) remaining-to-checkout for QUANTITY_TRACKED
     * assets — mirror of the check-in loader's `qtyRemainingByBookingAssetId`
     * but for the checkout direction. Polish-6 multi-row slices each get
     * their own attribution: a kit-driven slice and a standalone slice of
     * the same asset get independent `remaining` counts so the drawer's
     * pending-list can show them as separate rows.
     *
     * Helper is called once per QT slice — we `Promise.all` to avoid
     * serialising N round-trips. `computeBookingAssetSliceRemainingToCheckOut`
     * already pools claims across sibling slices and attributes
     * kit-driven-first, so per-slice and per-asset agree on the pool size.
     *
     * Calling `computeBookingAssetSliceRemainingToCheckOut` (and NOT
     * `computeBookingAssetSliceRemaining`, which is the check-IN equivalent)
     * is load-bearing — using the wrong helper silently shows check-IN
     * remaining counts on the checkout drawer.
     */
    const qtySlices = booking.bookingAssets.filter(
      (ba) => ba.asset?.type === AssetType.QUANTITY_TRACKED
    );
    const sliceRemainingPairs = await Promise.all(
      qtySlices.map(async (ba) => {
        const remaining = await computeBookingAssetSliceRemainingToCheckOut(
          db,
          booking.id,
          ba.id
        );
        return [ba.id, remaining] as const;
      })
    );
    const qtyRemainingByBookingAssetId: Record<
      string,
      {
        booked: number;
        logged: number;
        remaining: number;
        consumptionType: "ONE_WAY" | "TWO_WAY" | null;
      }
    > = {};
    for (const ba of qtySlices) {
      const pair = sliceRemainingPairs.find(([id]) => id === ba.id);
      const remaining = pair ? pair[1] : 0;
      const booked = ba.quantity ?? 0;
      // `logged` in checkout semantics: units already CLAIMED for checkout
      // by prior PartialBookingCheckout rows (units physically taken out of
      // the warehouse already). On check-in this would be "units already
      // returned"; on check-out it's "units already removed".
      const logged = Math.max(0, booked - remaining);
      qtyRemainingByBookingAssetId[ba.id] = {
        booked,
        logged,
        remaining,
        consumptionType:
          (ba.asset.consumptionType as "ONE_WAY" | "TWO_WAY" | null) ?? null,
      };
    }

    /**
     * Drawer "expected assets" list — one entry per BookingAsset row.
     * Same shape as the check-in loader builds (so the shared
     * `bookingExpectedAssetsAtom` + drawer rendering primitives work for
     * both directions). Polish-6 multi-row slices get separate entries so
     * the operator can see e.g. "kit-driven slice fully checked out" next
     * to "standalone slice still pending" instead of an aggregated
     * half-truth.
     *
     * `alreadyCheckedIn` on INDIVIDUAL entries reuses the existing field
     * name on the discriminated union; in checkout context it means
     * "already reconciled in this direction" — i.e. already checked OUT,
     * not already checked IN. Renaming to direction-neutral would touch
     * ~20 sites and is deferred to a separate cleanup commit.
     */
    const expectedAssets: BookingExpectedAsset[] = booking.bookingAssets.map(
      (ba) => {
        const asset = ba.asset;
        // Resolve kit attribution for THIS slice via `assetKitId` — a
        // standalone slice (`assetKitId === null`) renders as a loose row
        // even when the underlying asset belongs to other kits.
        const sourceKit = ba.assetKitId
          ? asset.assetKits.find((ak) => ak.id === ba.assetKitId)?.kit ?? null
          : null;
        const base = {
          id: asset.id,
          bookingAssetId: ba.id,
          title: asset.title,
          mainImage: asset.mainImage ?? null,
          thumbnailImage: asset.thumbnailImage ?? null,
          kitId: sourceKit?.id ?? null,
          kitName: sourceKit?.name ?? null,
        };

        if (asset.type === AssetType.QUANTITY_TRACKED) {
          const qty = qtyRemainingByBookingAssetId[ba.id];
          const booked = qty?.booked ?? ba.quantity ?? 0;
          const logged = qty?.logged ?? 0;
          const remaining = qty?.remaining ?? Math.max(0, booked - logged);
          return {
            ...base,
            kind: "QUANTITY_TRACKED" as const,
            booked,
            logged,
            remaining,
            // Checkout has no four-way RETURN/CONSUME/LOSS/DAMAGE split —
            // populate `returned: logged` so existing badge code (which
            // reads `breakdown.returned`) keeps working without widening
            // the discriminated union with a direction discriminator.
            breakdown: {
              returned: logged,
              consumed: 0,
              lost: 0,
              damaged: 0,
            },
            consumptionType: qty?.consumptionType ?? null,
          };
        }

        return {
          ...base,
          kind: "INDIVIDUAL" as const,
          // In checkout semantics this means "already checked OUT" (this
          // INDIVIDUAL asset appears in a prior PartialBookingCheckout
          // for this booking) — the field name on the union stays
          // direction-neutral despite reading "checkedIn".
          alreadyCheckedIn: checkedOutAssetIds.includes(asset.id),
        };
      }
    );

    /**
     * Bucket expected assets by kit so the drawer can render a kit
     * summary row (kit name, image, asset count) rather than N
     * individual rows for each kitted asset. Mirrors the check-in
     * loader's `expectedKits` bucketing — same `assetKitId`-driven
     * attribution rules.
     */
    const kitMap = new Map<
      string,
      {
        id: string;
        name: string;
        mainImage: string | null;
        assetIds: string[];
      }
    >();
    for (const ba of booking.bookingAssets) {
      const kit = ba.assetKitId
        ? ba.asset.assetKits.find((ak) => ak.id === ba.assetKitId)?.kit ?? null
        : null;
      const kitId = kit?.id ?? null;
      if (!kit || !kitId) continue;
      const entry = kitMap.get(kitId) ?? {
        id: kitId,
        name: kit.name,
        mainImage: kit.image ?? null,
        assetIds: [],
      };
      entry.assetIds.push(ba.asset.id);
      kitMap.set(kitId, entry);
    }
    const expectedKits = [...kitMap.values()];

    const title = `Scan assets to check out | ${booking.name}`;
    const header: HeaderData = {
      title,
    };

    return payload({
      title,
      header,
      booking,
      checkedOutAssetIds,
      checkedInAssetIds,
      remainingToCheckOutByAsset,
      expectedAssets,
      expectedKits,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }));

  try {
    assertIsPost(request);

    const { organizationId, role, userOrganizations } = await requirePermission(
      {
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.checkout,
      }
    );

    // Re-apply the same custodian/eligibility guard as the loader. The action
    // is directly POST-able and PermissionAction.checkout is granted to
    // SELF_SERVICE, so this prevents a self-service user from checking out
    // another user's booking in the same organization.
    await assertUserCanCheckoutBooking({
      bookingId,
      organizationId,
      userId,
      role,
      userOrganizations,
      request,
    });

    const formData = await request.formData();

    // Wave B: the scanner drawer can include a `checkouts` JSON field
    // alongside the legacy `assetIds[]` for per-slice quantities on
    // QUANTITY_TRACKED assets. The schema extension lives on
    // `partialCheckoutAssetsSchema` (imported by `checkoutAssets`), so
    // forwarding the FormData unchanged is sufficient.
    return await checkoutAssets({
      formData,
      request,
      bookingId,
      organizationId,
      userId,
      authSession,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Scan QR codes to check out",
  name: "booking.overview.checkout-assets",
};

export default function CheckoutAssetsFromBooking() {
  const { booking, expectedAssets } = useLoaderData<typeof loader>();
  const addItem = useSetAtom(addScannedItemAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  /**
   * Seed the shared partial-checkin atoms (reused for checkout — the
   * routes are never mounted simultaneously) with the loader's
   * expected-asset list. The drawer reads `bookingExpectedAssetsAtom`
   * to render the pending / scanned-this-session buckets. The hook
   * teardown on unmount clears the atom so navigating back to a
   * different booking (or to check-in) doesn't see stale data.
   */
  useBookingCheckinSessionInitialization({
    session: {
      bookingId: booking.id,
      bookingName: booking.name,
      status: booking.status,
      expectedCount: booking.bookingAssets.length,
    },
    expectedAssets,
  });

  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 67 : vh - 100;

  const savedCameraId = useScannerCameraId();

  function handleCodeDetectionSuccess({
    value: qrId,
    error,
    type,
  }: OnCodeDetectionSuccessProps) {
    /** Send the scanned data to the item. addItem will automatically handle the data based on its value */
    addItem(qrId, error, type);
  }

  return (
    <>
      <Header hidePageDescription />

      <PartialCheckoutDrawer isLoading={isLoading} defaultExpanded={true} />

      <div className="-mx-4 flex flex-col" style={{ height: `${height}px` }}>
        <CodeScanner
          isLoading={isLoading}
          onCodeDetectionSuccess={handleCodeDetectionSuccess}
          backButtonText="Booking"
          // backButtonUrl={`/bookings/${booking.id}?state=${AssetStatus.CHECKED_OUT}`}
          allowNonShelfCodes
          paused={false}
          setPaused={() => {}}
          scannerModeClassName={(mode) =>
            tw(mode === "scanner" && "justify-start pt-[100px]")
          }
          savedCameraId={savedCameraId}
        />
      </div>
    </>
  );
}
