import { OrganizationRoles } from "@prisma/client";
import { useSetAtom } from "jotai";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "react-router";
import { data, redirect, useLoaderData, useNavigation } from "react-router";
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
import { useBookingAssignSessionInitialization } from "~/hooks/use-booking-assign-session-initialization";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { ScannedKitSliceSpec } from "~/modules/booking/service.server";
import {
  addScannedAssetsToBooking,
  getBooking,
} from "~/modules/booking/service.server";
import { deriveBookingScanSession } from "~/modules/booking-model-request/scan-session.server";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  isSelfServiceOrBaseRole,
  validateBookingOwnership,
} from "~/utils/booking-authorization.server";
import { canUserManageBookingAssets } from "~/utils/bookings";
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
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: scannerCss },
];

/**
 * Loader for the Scan to Assign route.
 *
 * Auths the user against `booking.update`, loads the booking, and derives
 * `assignSession`: the outstanding model reservations and the assets already
 * on the booking, in the shape `useBookingAssignSessionInitialization` seeds
 * into the scanner atoms. `assignSession` is null when the booking reserves
 * no models, so the screen renders exactly as it did before this reservation
 * context existed.
 *
 * `booking:update` is a permission SELF_SERVICE and BASE both hold, so
 * neither role is stopped by `requirePermission` alone: past that gate, this
 * also proves the caller CREATED or holds CUSTODY of the booking, otherwise a
 * restricted user could open any booking in the workspace through this
 * screen. `canUserManageBookingAssets` cannot substitute for that check: it
 * reads only the booking's status, never `userId`.
 */
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
        action: PermissionAction.update,
      }
    );

    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const booking = await getBooking({
      id: bookingId,
      organizationId,
      userOrganizations,
      request,
    });

    /**
     * `booking:update` is a permission BASE holds as well as SELF_SERVICE,
     * unlike the fulfil-and-checkout screen's `booking:checkout`, which BASE
     * does not hold and so can leave BASE out of its own ownership check.
     * Without this, a SELF_SERVICE or BASE user could load another member's
     * booking, its outstanding reservations and its asset list through this
     * screen, even though the action below refuses the write. Matches the
     * role set the mobile twin (`api+/mobile+/bookings.add-scanned-assets.ts`)
     * restricts for this same operation, which also folds BASE in with
     * SELF_SERVICE.
     *
     * Ownership is judged before status, as on the sibling booking screens: a
     * caller with no claim on the booking should not learn what state it is
     * in.
     */
    if (isSelfServiceOrBaseRole(role)) {
      validateBookingOwnership({
        booking,
        userId,
        role,
        action: "add assets to",
      });
    }

    const canManageAssets = canUserManageBookingAssets(booking, isSelfService);

    if (!canManageAssets) {
      throw new ShelfError({
        cause: null,
        message:
          "You are not allowed to add assets for this booking at the moment.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    const title = `Scan assets for booking | ${booking.name}`;
    const header: HeaderData = {
      title,
    };

    /**
     * Reservation context for the scanner, or null when the booking reserves
     * no models and the drawer should look exactly as it always has.
     *
     * `getBooking` already returns everything `deriveBookingScanSession`
     * needs, so there is no extra query here beyond its own supplementary
     * asset lookup: `modelRequests` with its model's name, and
     * `bookingAssets` with every scalar plus the asset's type. The
     * derivation is shared with the Check Out scanner's loader so a scan can
     * never be worth a different amount depending which screen is open.
     */
    const { expectedModelRequests, alreadyIncluded } =
      await deriveBookingScanSession({
        modelRequests: booking.modelRequests,
        bookingAssets: booking.bookingAssets,
        organizationId,
      });

    const assignSession =
      expectedModelRequests.length === 0
        ? null
        : { expectedModelRequests, alreadyIncluded };

    return payload({ title, header, booking, assignSession });
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

    const { organizationId, role, isSelfServiceOrBase } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.update,
      });

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

    /**
     * `requirePermission` above only proves the caller holds `booking:update`
     * in this organization. BASE holds it too, unlike the fulfil-and-checkout
     * action's `booking:checkout`, which is why that route can leave BASE out
     * of its own ownership check. Without this, a direct POST from a
     * SELF_SERVICE or BASE user could write to a booking they neither created
     * nor hold custody of; the loader's `canUserManageBookingAssets` only
     * shapes what renders, it is not consulted on a POST that skips the page.
     * Runs before `addScannedAssetsToBooking`, which is the write it guards.
     * Matches the role set the mobile twin
     * (`api+/mobile+/bookings.add-scanned-assets.ts`) restricts for this same
     * operation, which also folds BASE in with SELF_SERVICE.
     */
    if (isSelfServiceOrBase) {
      const basicBookingInfo = await db.booking.findUniqueOrThrow({
        where: { id: bookingId, organizationId },
        select: { creatorId: true, custodianUserId: true },
      });

      validateBookingOwnership({
        booking: basicBookingInfo,
        userId,
        role,
        action: "add assets to",
      });
    }

    const { addedAssetIds, claimedAssetIds } = await addScannedAssetsToBooking({
      bookingId,
      assetIds: standaloneAssetIds,
      kitIds,
      organizationId,
      userId,
      quantities,
      kitSlices,
    });

    /**
     * A scan can legitimately change nothing: every item may already sit on
     * the booking. `addedAssetIds` is what got a new row; `claimedAssetIds`
     * is what counted an EXISTING row toward a reservation without a new one.
     * The notification names whichever actually happened, since a blanket
     * "added" claim is false the moment neither set has anything in it.
     */
    const addedCount = addedAssetIds.length;
    const claimedCount = claimedAssetIds.length;

    if (addedCount > 0) {
      sendNotification({
        title: "Assets added",
        message:
          addedCount === 1
            ? "The scanned asset was added to the booking."
            : `${addedCount} scanned assets were added to the booking.`,
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
    } else if (claimedCount > 0) {
      sendNotification({
        title: "Reservation updated",
        message:
          claimedCount === 1
            ? "That asset was already on the booking. It now counts toward a reservation."
            : "Those assets were already on the booking. They now count toward reservations.",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
    } else {
      sendNotification({
        title: "Nothing to add",
        message: "Every scanned item is already on this booking.",
        icon: { name: "scan", variant: "gray" },
        senderId: authSession.userId,
      });
    }

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
  const { booking, assignSession } = useLoaderData<typeof loader>();
  useBookingAssignSessionInitialization({
    session: assignSession,
    bookingId: booking.id,
  });

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
