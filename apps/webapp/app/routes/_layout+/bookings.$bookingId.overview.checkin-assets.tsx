import { OrganizationRoles } from "@prisma/client";
import { useSetAtom } from "jotai";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "react-router";
import { data, useNavigation } from "react-router";
import { z } from "zod";
import { addScannedItemAtom } from "~/atoms/qr-scanner";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { CodeScanner } from "~/components/scanner/code-scanner";
import PartialCheckinDrawer from "~/components/scanner/drawer/uses/partial-checkin-drawer";
import { db } from "~/database/db.server";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { isQuantityTracked } from "~/modules/asset/utils";
import {
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

    const loggedSums =
      qtyAssetIds.length > 0
        ? await db.consumptionLog.groupBy({
            by: ["assetId"],
            where: {
              bookingId: booking.id,
              assetId: { in: qtyAssetIds },
              category: { in: ["RETURN", "CONSUME", "LOSS", "DAMAGE"] },
            },
            _sum: { quantity: true },
          })
        : [];

    const loggedSumById = new Map<string, number>(
      loggedSums.map((row) => [row.assetId, row._sum.quantity ?? 0])
    );

    /**
     * Shape consumed by `partial-checkin-drawer.tsx`:
     *   { [assetId]: { booked, logged, remaining, consumptionType } }
     * `consumptionType` lets the drawer pick between "Returned" (TWO_WAY)
     * and "Consumed" (ONE_WAY) as the primary input label.
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
      const logged = loggedSumById.get(ba.assetId) ?? 0;
      qtyRemainingByAssetId[ba.assetId] = {
        booked,
        logged,
        remaining: Math.max(0, booked - logged),
        consumptionType:
          (ba.asset.consumptionType as "ONE_WAY" | "TWO_WAY" | null) ?? null,
      };
    }

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
  const addItem = useSetAtom(addScannedItemAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

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
