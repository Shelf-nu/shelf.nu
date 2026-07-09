import { OrganizationRoles } from "@prisma/client";
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
import PartialCheckinDrawer from "~/components/scanner/drawer/uses/partial-checkin-drawer";
import { db } from "~/database/db.server";
import { useBookingCheckinSessionInitialization } from "~/hooks/use-booking-checkin-session-initialization";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { isQuantityTracked } from "~/modules/asset/utils";
import {
  attributeCategorizedDispositionsByBookingAsset,
  checkinAssets,
  getBooking,
  getDetailedPartialCheckinData,
} from "~/modules/booking/service.server";
import { calculatePartialCheckinProgress } from "~/modules/booking/utils.server";
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
        action: PermissionAction.checkin,
      }
    );

    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const booking = await getBooking({
      id: bookingId,
      organizationId,
      userOrganizations,
      request,
    });

    // For check-in, self-service users are allowed when the booking is
    // ongoing or overdue (check-in eligible states) AND they are the
    // custodian. The generic canUserManageBookingAssets blocks self-service
    // on non-draft bookings, but that restriction is for adding/removing
    // assets, not for checking in.
    const isCheckinEligible =
      booking.status === "ONGOING" || booking.status === "OVERDUE";
    const isCustodian = booking.custodianUserId === userId;
    const canCheckin =
      isSelfService && isCheckinEligible && isCustodian
        ? true
        : canUserManageBookingAssets(booking, isSelfService);

    if (!canCheckin) {
      throw new ShelfError({
        cause: null,
        message:
          "You cannot check in assets for this booking at the moment. The booking may not be ongoing or you may not have permission to manage its assets.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    // Always fetch partial check-in data for scanner validation
    // We need this data to detect blockers for already checked-in assets/kits
    const { checkedInAssetIds, partialCheckinDetails } =
      await getDetailedPartialCheckinData(booking.id);

    // Calculate partial check-in progress
    // For progress calculation, we need the TOTAL number of assets in the booking,
    // not the filtered count from booking.assets (which may be filtered by status)
    const totalBookingAssets = await db.bookingAsset.count({
      where: {
        bookingId: booking.id,
      },
    });

    const partialCheckinProgress = calculatePartialCheckinProgress(
      totalBookingAssets,
      checkedInAssetIds,
      booking.status
    );

    /**
     * Phase 3c: compute per-asset "remaining" for QUANTITY_TRACKED assets
     * in this booking. `remaining = BookingAsset.quantity − Σ(RETURN +
     * CONSUME + LOSS + DAMAGE ConsumptionLog entries for this pair)`.
     *
     * Sent to the drawer so the UI can cap the per-row inputs, drive the
     * auto-expand of the shortfall disclosure, and render a "fully
     * reconciled → hidden" state. We compute with a single aggregate
     * query + a lookup against the booking's already-loaded
     * `bookingAssets` to avoid an N+1.
     */
    const qtyTrackedAssets = booking.bookingAssets.filter((ba) =>
      isQuantityTracked(ba.asset)
    );
    const qtyAssetIds = qtyTrackedAssets.map((ba) => ba.assetId);

    /**
     * Per-row attribution: ConsumptionLog now carries `bookingAssetId`,
     * letting us split a (booking, asset)'s dispositions across its
     * multiple BookingAsset slices (kit-driven + standalone). Legacy
     * NULL-bookingAssetId rows get greedy-attributed (standalone first)
     * by `attributeDispositionsByBookingAsset`.
     */
    const dispositionLogs =
      qtyAssetIds.length > 0
        ? await db.consumptionLog.findMany({
            where: {
              bookingId: booking.id,
              assetId: { in: qtyAssetIds },
              category: { in: ["RETURN", "CONSUME", "LOSS", "DAMAGE"] },
            },
            select: {
              assetId: true,
              category: true,
              quantity: true,
              bookingAssetId: true,
            },
          })
        : [];

    const logsByAsset = new Map<
      string,
      Array<{
        bookingAssetId: string | null;
        category: "RETURN" | "CONSUME" | "LOSS" | "DAMAGE";
        quantity: number;
      }>
    >();
    for (const log of dispositionLogs) {
      const arr = logsByAsset.get(log.assetId) ?? [];
      arr.push({
        bookingAssetId: log.bookingAssetId ?? null,
        category: log.category as "RETURN" | "CONSUME" | "LOSS" | "DAMAGE",
        quantity: log.quantity,
      });
      logsByAsset.set(log.assetId, arr);
    }

    /**
     * Per-bookingAssetId "logged" total + category breakdown. The drawer
     * consumes these via the bookingAssetId key so two slices of the
     * same asset display separately (kit-driven fully reconciled vs
     * standalone still pending), each with its own Booked/Returned/
     * Consumed/Lost/Remaining tooltip.
     */
    const loggedByBookingAssetId = new Map<string, number>();
    const breakdownByBookingAssetId = new Map<
      string,
      { returned: number; consumed: number; lost: number; damaged: number }
    >();
    const rowsByAsset = new Map<
      string,
      Array<{
        id: string;
        quantity: number;
        assetKitId: string | null;
      }>
    >();
    for (const ba of qtyTrackedAssets) {
      const arr = rowsByAsset.get(ba.assetId) ?? [];
      arr.push({
        id: ba.id,
        quantity: ba.quantity,
        assetKitId: ba.assetKitId ?? null,
      });
      rowsByAsset.set(ba.assetId, arr);
    }
    for (const [assetId, rows] of rowsByAsset) {
      const attributed = attributeCategorizedDispositionsByBookingAsset({
        bookingAssetRows: rows,
        consumptionLogs: logsByAsset.get(assetId) ?? [],
      });
      for (const [bookingAssetId, b] of attributed) {
        breakdownByBookingAssetId.set(bookingAssetId, b);
        loggedByBookingAssetId.set(
          bookingAssetId,
          b.returned + b.consumed + b.lost + b.damaged
        );
      }
    }

    /**
     * Shape consumed by `partial-checkin-drawer.tsx`:
     *   { [bookingAssetId]: { booked, logged, remaining, consumptionType } }
     * `consumptionType` lets the drawer pick between "Returned" (TWO_WAY)
     * and "Consumed" (ONE_WAY) as the primary input label.
     */
    const qtyRemainingByBookingAssetId: Record<
      string,
      {
        booked: number;
        logged: number;
        remaining: number;
        consumptionType: "ONE_WAY" | "TWO_WAY" | null;
      }
    > = {};

    /**
     * Asset-level rollup of the per-row map. Used by the drawer's
     * legacy lookups that still key by `assetId` (e.g. pool-drain
     * validation, "all units of this asset still pending" checks).
     * For QUANTITY_TRACKED assets with multiple slices, `booked` and
     * `logged` are summed across rows; `remaining` is the asset's
     * total outstanding. The new per-bookingAssetId map below is the
     * source of truth for per-row UI.
     */
    const qtyRemainingByAssetId: Record<
      string,
      {
        booked: number;
        logged: number;
        remaining: number;
        consumptionType: "ONE_WAY" | "TWO_WAY" | null;
      }
    > = {};

    for (const ba of qtyTrackedAssets) {
      const booked = ba.quantity ?? 0;
      const logged = loggedByBookingAssetId.get(ba.id) ?? 0;
      qtyRemainingByBookingAssetId[ba.id] = {
        booked,
        logged,
        remaining: Math.max(0, booked - logged),
        consumptionType:
          (ba.asset.consumptionType as "ONE_WAY" | "TWO_WAY" | null) ?? null,
      };

      const aggregate = qtyRemainingByAssetId[ba.assetId] ?? {
        booked: 0,
        logged: 0,
        remaining: 0,
        consumptionType:
          (ba.asset.consumptionType as "ONE_WAY" | "TWO_WAY" | null) ?? null,
      };
      aggregate.booked += booked;
      aggregate.logged += logged;
      aggregate.remaining = Math.max(0, aggregate.booked - aggregate.logged);
      qtyRemainingByAssetId[ba.assetId] = aggregate;
    }

    /**
     * Drawer "expected assets" list — one entry per BookingAsset row.
     * Polish-6 multi-row slices get separate entries so the user can
     * see "kit-driven slice done" alongside "standalone slice still
     * pending" instead of an aggregated half-truth.
     */
    const expectedAssets: BookingExpectedAsset[] = booking.bookingAssets.map(
      (ba) => {
        const asset = ba.asset;
        // Resolve the kit attribution for THIS slice (kit-driven row
        // has `assetKitId`; standalone rows fall back to null even when
        // the asset happens to belong to other kits).
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

        if (asset.type === "QUANTITY_TRACKED") {
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
            breakdown: breakdownByBookingAssetId.get(ba.id) ?? {
              returned: 0,
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
          alreadyCheckedIn: Boolean(partialCheckinDetails[asset.id]),
        };
      }
    );

    /**
     * Bucket expected assets by kit so the drawer can render a kit
     * summary row (kit name, image, asset count) rather than N
     * individual rows for each kitted asset.
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
      // Resolve the kit for THIS slice via its `assetKitId` discriminator
      // (not `assetKits[0]`, which is just the asset's first membership).
      // Standalone slices (`assetKitId === null`) contribute no kit — the
      // drawer renders them as loose rows.
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

    const title = `Scan assets to check in | ${booking.name}`;
    const header: HeaderData = {
      title,
    };

    return payload({
      title,
      header,
      booking,
      partialCheckinProgress,
      partialCheckinDetails,
      qtyRemainingByAssetId,
      qtyRemainingByBookingAssetId,
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

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.checkin,
    });

    const formData = await request.formData();

    return await checkinAssets({
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
  breadcrumb: () => "Scan QR codes to check in",
  name: "booking.overview.checkin-assets",
};

export default function CheckinAssetsFromBooking() {
  const { booking, expectedAssets } = useLoaderData<typeof loader>();
  const addItem = useSetAtom(addScannedItemAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  /**
   * Seed the partial-checkin atoms with the loader's expected-asset
   * list. The drawer reads `bookingExpectedAssetsAtom` to render the
   * pending / scanned / already-reconciled buckets (mirrors the
   * audits drawer pattern).
   */
  useBookingCheckinSessionInitialization({
    session: {
      bookingId: booking.id,
      bookingName: booking.name,
      status: booking.status,
      expectedCount: expectedAssets.length,
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

      <PartialCheckinDrawer isLoading={isLoading} defaultExpanded={true} />

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
