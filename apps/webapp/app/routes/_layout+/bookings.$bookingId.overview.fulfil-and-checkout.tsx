/**
 * Fulfil Reservations & Check Out Route
 *
 * Dedicated scanner route for bookings that still carry outstanding
 * `BookingModelRequest` rows (Phase 3d — Book-by-Model). Opening the
 * route shows the operator *what's expected* (pending model rows
 * rendered from `modelRequests`), lets them scan concrete assets to
 * fulfil those requests, and — on submit — materialises the requests
 * AND transitions the booking from `RESERVED → ONGOING` in a single
 * atomic transaction via `fulfilModelRequestsAndCheckout`.
 *
 * Mirrors `bookings.$bookingId.overview.scan-assets.tsx` for the
 * scanner shell (header, camera, `addScannedItemAtom`). The drawer
 * variant (`FulfilReservationsDrawer`) renders the expected-list
 * preview + progress strips + early-checkout dialog wiring.
 *
 * Redirects to `/bookings/:id` when the booking has **no**
 * outstanding model requests — in that case the operator should use
 * the normal checkout path directly; the fulfil detour would just be
 * ceremony.
 *
 * @see {@link file://./../../modules/booking/service.server.ts} —
 *   `fulfilModelRequestsAndCheckout` (T2).
 * @see {@link file://./../../components/scanner/drawer/uses/fulfil-reservations-drawer.tsx}
 *   — drawer UI (T5).
 * @see {@link file://./../../hooks/use-booking-fulfil-session-initialization.ts}
 *   — atom seeding hook (T4).
 * @see {@link file://./../../atoms/qr-scanner.ts} — fulfil atoms (T1).
 */

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
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { CodeScanner } from "~/components/scanner/code-scanner";
import FulfilReservationsDrawer from "~/components/scanner/drawer/uses/fulfil-reservations-drawer";
import { db } from "~/database/db.server";
import { useBookingFulfilSessionInitialization } from "~/hooks/use-booking-fulfil-session-initialization";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import {
  fulfilModelRequestsAndCheckout,
  getBooking,
} from "~/modules/booking/service.server";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { canUserManageBookingAssets } from "~/utils/bookings";
import { getClientHint } from "~/utils/client-hints";
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
 * Zod schema for the fulfil-and-checkout action payload.
 *
 * - `assetIds`: concrete asset IDs the operator scanned in the drawer
 *   (matched OR off-model — server matches them against outstanding
 *   `BookingModelRequest` rows and creates `BookingAsset` rows).
 * - `kitIds`: present for forward compatibility — kit-level
 *   `BookingModelRequest`s don't exist today, so the server will
 *   reject non-empty kits when there are outstanding model requests.
 *   We still plumb the field through so the drawer can evolve without
 *   a schema change.
 * - `checkoutIntentChoice`: the operator's answer to the early-
 *   checkout alert (`with-adjusted-date` | `without-adjusted-date`).
 *   Only meaningful when `isBookingEarlyCheckout(booking.from)` is
 *   true; otherwise the service ignores it.
 *
 * Exported so the drawer (T5) can reuse the same schema for
 * client-side form validation.
 */
export const fulfilAndCheckoutSchema = z.object({
  assetIds: z.array(z.string()).default([]),
  kitIds: z.array(z.string()).optional().default([]),
  checkoutIntentChoice: z.nativeEnum(CheckoutIntentEnum).optional(),
});

/**
 * Loader for the fulfil-and-checkout route.
 *
 * - Auths the user against `booking.update`.
 * - Loads the booking with its `modelRequests` + `bookingAssets` so
 *   the drawer can render both expected pending rows AND the
 *   already-included concrete assets.
 * - Rejects if the user can't manage the booking (mirrors
 *   scan-assets).
 * - Short-circuits to `/bookings/:id` when there are zero outstanding
 *   model requests — the regular checkout flow is correct in that
 *   case and the fulfil scanner would be a confusing detour.
 * - Supplements the booking query with a lightweight lookup of each
 *   `bookingAsset.assetId → assetModelId` because the default
 *   `BOOKING_WITH_ASSETS_INCLUDE` on `getBooking` doesn't select
 *   `assetModelId` on the nested asset row. The drawer needs this to
 *   group "already included" entries by model and to compute
 *   per-model progress without issuing a follow-up round-trip.
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

    /**
     * Outstanding model requests — anything with `fulfilledAt === null`
     * still needs fulfilment. If none remain, this route has nothing to
     * do; send the operator back to the booking page where the normal
     * checkout flow lives. `booked` reflects the original reservation
     * intent (for progress denominators); `remaining` is what's still
     * outstanding after any prior partial-scan progress, so the drawer
     * pre-populates the right number of pending rows.
     */
    const expectedModelRequests = booking.modelRequests
      .filter((r) => r.fulfilledAt === null)
      .map((r) => ({
        assetModelId: r.assetModelId,
        assetModelName: r.assetModel.name,
        booked: r.quantity,
        remaining: r.quantity - r.fulfilledQuantity,
      }));

    if (expectedModelRequests.length === 0) {
      return redirect(`/bookings/${bookingId}`);
    }

    /**
     * Supplementary lookup: `assetModelId` per `BookingAsset.assetId`
     * (not selected by `BOOKING_WITH_ASSETS_INCLUDE`). Cheap — narrow
     * `select` on at most N rows where N = booking.bookingAssets
     * length. Keeps the expensive `getBooking` call unchanged.
     */
    const alreadyIncludedAssetIds = booking.bookingAssets.map(
      (ba) => ba.asset.id
    );
    const assetModelIdByAssetId = new Map<string, string | null>();
    if (alreadyIncludedAssetIds.length > 0) {
      const rows = await db.asset.findMany({
        where: {
          id: { in: alreadyIncludedAssetIds },
          organizationId,
        },
        select: { id: true, assetModelId: true },
      });
      for (const row of rows) {
        assetModelIdByAssetId.set(row.id, row.assetModelId);
      }
    }

    const alreadyIncluded = booking.bookingAssets.map((ba) => ({
      id: ba.asset.id,
      title: ba.asset.title,
      mainImage: ba.asset.mainImage,
      thumbnailImage: ba.asset.thumbnailImage,
      assetModelId: assetModelIdByAssetId.get(ba.asset.id) ?? null,
      kitId: ba.asset.kitId,
      // `ba.quantity` is the BOOKING-specific unit count (from the
      // `BookingAsset` pivot) — always `1` for INDIVIDUAL, `N` for
      // QUANTITY_TRACKED. Needed so the drawer's "Already included"
      // section can render `"Pens × 20"` for qty-tracked rows.
      bookedQuantity: ba.quantity,
      type: ba.asset.type as "INDIVIDUAL" | "QUANTITY_TRACKED",
    }));

    const title = `Fulfil reservations & check out | ${booking.name}`;
    const header: HeaderData = {
      title,
    };

    return payload({
      title,
      header,
      booking,
      expectedModelRequests,
      alreadyIncluded,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * Action for the fulfil-and-checkout route.
 *
 * Parses the drawer-submitted payload, delegates to
 * `fulfilModelRequestsAndCheckout` (single atomic tx: materialise
 * requests → create BookingAssets → optional early-date rewrite →
 * status transition → post-commit emails/scheduler), and redirects
 * back to the booking page on success.
 *
 * `hints` is required by the service for the timezone-aware early-
 * date rewrite and the check-in scheduler — matches how the existing
 * `checkOut` intent wires `getClientHint(request)` in
 * `bookings.$bookingId.overview.tsx`.
 */
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
      action: PermissionAction.update,
    });

    const formData = await request.formData();

    const { assetIds, kitIds, checkoutIntentChoice } = parseData(
      formData,
      fulfilAndCheckoutSchema
    );

    /**
     * Pull the booking's from/to for the pre-tx conflict guard inside
     * the service (mirrors the existing `checkoutBooking` caller in
     * `bookings.$bookingId.overview.tsx`).
     */
    const basicBookingInfo = await db.booking.findUniqueOrThrow({
      where: { id: bookingId, organizationId },
      select: { from: true, to: true },
    });

    await fulfilModelRequestsAndCheckout({
      bookingId,
      organizationId,
      userId,
      assetIds,
      kitIds,
      checkoutIntentChoice,
      hints: getClientHint(request),
      from: basicBookingInfo.from,
      to: basicBookingInfo.to,
    });

    sendNotification({
      title: "Checked out",
      message: "Your booking has been checked out successfully",
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
  breadcrumb: () => "Fulfil reservations & check out",
  name: "booking.overview.fulfil-and-checkout",
};

/**
 * Fulfil-and-checkout scanner shell.
 *
 * Seeds the fulfil session atoms from the loader payload, renders the
 * drawer + camera, and forwards QR detections to the shared
 * `addScannedItemAtom`. All actual fulfil-specific UI lives in
 * `FulfilReservationsDrawer` (T5); this component is intentionally a
 * thin harness, matching `scan-assets.tsx`.
 */
export default function FulfilAndCheckoutForBooking() {
  const addItem = useSetAtom(addScannedItemAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 67 : vh - 100;

  const savedCameraId = useScannerCameraId();

  // The shell needs the loader payload to seed the fulfil session
  // atoms on mount via `useBookingFulfilSessionInitialization`. The
  // drawer (T5) also reads `useLoaderData` directly for its own
  // rendering — that's fine; `useLoaderData` dedupes via the router
  // context.
  const { booking, expectedModelRequests, alreadyIncluded } =
    useLoaderData<typeof loader>();

  useBookingFulfilSessionInitialization({
    session: {
      bookingId: booking.id,
      bookingName: booking.name,
      // `booking.from` can be null at the Prisma level but any booking
      // that reaches the fulfil flow must have a `from` — it's set at
      // reserve time. We ISO-stringify defensively; the atom consumer
      // falls back gracefully when the string is invalid.
      bookingFrom: booking.from
        ? new Date(booking.from).toISOString()
        : new Date().toISOString(),
      expectedModelRequests,
      alreadyIncluded,
    },
  });

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

      <FulfilReservationsDrawer isLoading={isLoading} />

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
