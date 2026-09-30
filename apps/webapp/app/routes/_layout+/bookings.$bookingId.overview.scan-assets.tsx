import { useSetAtom } from "jotai";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "react-router";
import { data, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { addScannedItemAtom } from "~/atoms/qr-scanner";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { CodeScanner } from "~/components/scanner/code-scanner";
import AddAssetsToBookingDrawer, {
  addScannedAssetsToBookingSchema,
} from "~/components/scanner/drawer/uses/add-assets-to-booking-drawer";
import { db } from "~/database/db.server";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { ScannedKitSliceSpec } from "~/modules/booking/service.server";
import {
  addScannedAssetsToBooking,
  getBooking,
} from "~/modules/booking/service.server";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  assertCanAddBookingItems,
  validateBookingOwnership,
} from "~/utils/booking-authorization.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  assertIsPost,
  payload,
  error,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { canManageBookingItems } from "~/utils/permissions/role-access";
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
    const { organizationId, access, userOrganizations } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.update,
      });

    const booking = await getBooking({
      id: bookingId,
      organizationId,
      userOrganizations,
      request,
    });

    // Seeing a booking does not grant writing it: the action refuses the same
    // callers, so the page does not offer them a scanner that cannot submit.
    validateBookingOwnership({
      booking,
      userId,
      access,
      action: "add items to",
    });

    // The same add rule as every other add path (manage-assets, manage-kits,
    // add-to-existing-booking, mobile add-scanned-assets).
    const canManageAssets = canManageBookingItems({
      access,
      bookingStatus: booking.status,
    });

    if (!canManageAssets) {
      throw new ShelfError({
        cause: null,
        message:
          "You are not allowed to add assets for this booking at the moment.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }
    const title = `Scan assets for booking | ${booking.name}`;
    const header: HeaderData = {
      title,
    };

    return payload({ title, header, booking });
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

    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    // `booking:update` is held by every role, so it settles nothing about THIS
    // booking: a caller who does not write every booking must own it, and the
    // status must accept new items for the caller's role. The service still
    // re-checks, under a row lock, that the booking is not closed.
    const target = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { status: true, creatorId: true, custodianUserId: true },
    });
    if (!target) {
      throw new ShelfError({
        cause: null,
        title: "Not found",
        message: "Booking not found.",
        label: "Booking",
        status: 404,
        shouldBeCaptured: false,
      });
    }
    validateBookingOwnership({
      booking: target,
      userId,
      access,
      action: "add items to",
    });
    assertCanAddBookingItems({ access, bookingStatus: target.status });

    const formData = await request.formData();

    const {
      assetIds,
      kitIds,
      quantities: rawQuantities,
      kitSlices: rawKitSlices,
    } = parseData(formData, addScannedAssetsToBookingSchema);

    // Parse the JSON-encoded `quantities` blob into a
    // Record<assetId, qty>. Shape-only validation here (positive int,
    // sane upper bound); availability re-validation lives in
    // `addScannedAssetsToBooking` / the booking trigger downstream.
    let quantities: Record<string, number> = {};
    if (rawQuantities && rawQuantities !== "{}") {
      try {
        const parsed = JSON.parse(rawQuantities);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("expected object");
        }
        for (const [assetId, rawValue] of Object.entries(
          parsed as Record<string, unknown>
        )) {
          const value =
            typeof rawValue === "number" ? rawValue : Number(rawValue);
          if (
            !Number.isFinite(value) ||
            !Number.isInteger(value) ||
            value < 1 ||
            value > 1_000_000
          ) {
            throw new Error(`invalid quantity for ${assetId}`);
          }
          quantities[assetId] = value;
        }
      } catch (e) {
        throw new ShelfError({
          cause: e,
          message: `Invalid quantities payload: ${
            e instanceof Error ? e.message : "parse error"
          }`,
          status: 400,
          label: "Booking",
          additionalData: { userId, bookingId },
        });
      }
    }

    // Parse the kit-slice specs the drawer sends. Shape-only validation
    // here; the service trusts the IDs and will fail at the FK level if a
    // stale assetKitId is submitted. One element per (asset, AssetKit)
    // membership, so an asset scanned via two kits yields two slices.
    const kitSlices: ScannedKitSliceSpec[] = [];
    if (rawKitSlices && rawKitSlices !== "[]") {
      try {
        const parsed = JSON.parse(rawKitSlices);
        if (!Array.isArray(parsed)) {
          throw new Error("expected array");
        }
        for (const entry of parsed as unknown[]) {
          if (typeof entry !== "object" || entry === null) {
            throw new Error("expected object entry");
          }
          const { assetId, assetKitId, kitId } = entry as Record<
            string,
            unknown
          >;
          if (
            typeof assetId !== "string" ||
            assetId.length === 0 ||
            typeof assetKitId !== "string" ||
            assetKitId.length === 0
          ) {
            throw new Error("invalid kit slice entry");
          }
          // why: `kitId` is deliberately NOT required. It feeds
          // `BookingAsset.sourceKitId`, but the service re-resolves that from
          // the `AssetKit` row `assetKitId` points at — already proven in-org
          // by `assertAssetKitsBelongToOrg` — and the server-resolved value
          // WINS over anything sent here. Rejecting a payload that omits it
          // would 400 every browser tab left open across the deploy while
          // buying zero safety, so a stale client is filled in server-side
          // instead. Empty string means "client didn't say"; the service
          // normalizes it away.
          kitSlices.push({
            assetId,
            assetKitId,
            kitId: typeof kitId === "string" ? kitId : "",
          });
        }
      } catch (e) {
        throw new ShelfError({
          cause: e,
          message: `Invalid kitSlices payload: ${
            e instanceof Error ? e.message : "parse error"
          }`,
          status: 400,
          label: "Booking",
          additionalData: { userId, bookingId },
        });
      }
    }

    // The drawer sends the full union in `assetIds`. Split out the
    // standalone bucket (everything not represented by a kit slice) so
    // kit members go through the kit-driven path and standalone scans
    // stay standalone.
    const kitSliceAssetIds = new Set(kitSlices.map((s) => s.assetId));
    const standaloneAssetIds = assetIds.filter(
      (id) => !kitSliceAssetIds.has(id)
    );

    await addScannedAssetsToBooking({
      bookingId,
      assetIds: standaloneAssetIds,
      kitIds,
      organizationId,
      userId,
      quantities,
      kitSlices,
    });

    sendNotification({
      title: "Assets added",
      message: "All the scanned assets has been successfully added to booking.",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/bookings/${bookingId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Scan QR codes to add to booking",
  name: "booking.overview.scan-assets",
};

export default function ScanAssetsForBookings() {
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
    /** WE send the error to the item. addItem will automatically handle the data based on its value */
    addItem(qrId, error, type);
  }

  return (
    <>
      <Header hidePageDescription />

      <AddAssetsToBookingDrawer isLoading={isLoading} />

      <div className="-mx-4 flex flex-col" style={{ height: `${height}px` }}>
        <CodeScanner
          isLoading={isLoading}
          onCodeDetectionSuccess={handleCodeDetectionSuccess}
          backButtonText="Booking"
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
