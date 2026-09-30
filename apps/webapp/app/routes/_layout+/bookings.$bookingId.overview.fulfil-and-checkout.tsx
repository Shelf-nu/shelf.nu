/**
 * Fulfil Reservations & Check Out Route
 *
 * Dedicated scanner route for bookings that still carry outstanding
 * `BookingModelRequest` rows (book-by-model). Opening the
 * route shows the operator *what's expected* (pending model rows
 * rendered from `modelRequests`), lets them scan concrete assets to
 * fulfil those requests, and — on submit — delegates to
 * `fulfilAndCheckOut`, which materialises the requests and then checks
 * the booking out: the whole booking, or, under the workspace's
 * explicit check-out requirement, only the scanned units.
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
 * @see {@link file://./../../modules/booking/fulfil-and-checkout.server.ts}
 *   — orchestrates the full vs. partial check-out.
 * @see {@link file://./../../components/scanner/drawer/uses/fulfil-reservations-drawer.tsx}
 *   — drawer UI.
 * @see {@link file://./../../hooks/use-booking-fulfil-session-initialization.ts}
 *   — atom seeding hook.
 * @see {@link file://./../../atoms/qr-scanner.ts} — fulfil atoms.
 * @see {@link file://./../../modules/booking-model-request/scan-session.server.ts}
 *   for the loader derivation shared with the Scan to Assign screen.
 */

import { BookingStatus } from "@prisma/client";
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
import { fulfilAndCheckOut } from "~/modules/booking/fulfil-and-checkout.server";
import { getBooking } from "~/modules/booking/service.server";
import { deriveBookingScanSession } from "~/modules/booking-model-request/scan-session.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
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
import { isExplicitScanRequired } from "~/utils/permissions/role-access";
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
 * - `kitIds`: kit IDs the operator scanned in the drawer. The server
 *   resolves each into kit-driven `BookingAsset` rows and assigns their
 *   INDIVIDUAL members against outstanding `BookingModelRequest` rows,
 *   exactly as it does for a directly scanned asset. Members are not
 *   listed in `assetIds` — sending one both ways would book it twice.
 * - `checkoutIntentChoice`: the operator's answer to the early-
 *   checkout alert (`with-adjusted-date` | `without-adjusted-date`).
 *   Only meaningful when `isBookingEarlyCheckout(booking.from)` is
 *   true; otherwise the service ignores it.
 *
 * Exported so the drawer can reuse the same schema for
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
 * - Tells the drawer whether submit sends out only the scanned items, so
 *   its "something to check out" rule matches the action's.
 * - Derives `expectedModelRequests` and `alreadyIncluded` via
 *   `deriveBookingScanSession`, shared with the Scan to Assign loader so
 *   the two screens can never disagree about what a scan is worth.
 * - Short-circuits to `/bookings/:id` when there are zero outstanding
 *   model requests: the regular checkout flow is correct in that case and
 *   the fulfil scanner would be a confusing detour.
 */
/** Statuses a booking can be checked out in, as `fulfilAndCheckOut` accepts. */
const FULFILLABLE_STATUSES: string[] = ["RESERVED", "ONGOING", "OVERDUE"];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    // Matches the action's gate: this screen exists only to check out, so a
    // role without `booking:checkout` should not reach it at all.
    const { organizationId, userOrganizations, access } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.checkout,
      });

    const booking = await getBooking({
      id: bookingId,
      organizationId,
      userOrganizations,
      request,
    });

    // Seeing a booking does not grant checking it out: a caller who does not
    // write every booking must own it. The action refuses the same callers, so
    // this keeps another member's booking, model requests and asset data off
    // this screen. No-op when `access.bookings.writeAll`.
    validateBookingOwnership({
      booking,
      userId,
      access,
      action: "check out",
    });

    // This screen is a check-out, so it takes the check-out rule (the
    // permission above, ownership, and a status that can be checked out), not
    // the add-items rule: assigning reserved units is part of checking the
    // booking out, which Self service may do on its own booking. The service
    // re-checks the status under a row lock.
    if (!FULFILLABLE_STATUSES.includes(booking.status)) {
      throw new ShelfError({
        cause: null,
        message: "This booking cannot be checked out in its current status.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    /**
     * Outstanding model requests plus the assets already on the booking that
     * a scan could still make answer one, derived through the predicate and
     * rule both booking scanners share (this screen and Scan to Assign) so a
     * scan is never worth a different amount depending which is open.
     *
     * If nothing remains outstanding, this route has nothing to do; send the
     * operator back to the booking page where the normal checkout flow
     * lives. `booked` reflects the original reservation intent (for progress
     * denominators); `remaining` is what's still outstanding after any prior
     * partial-scan progress, so the drawer pre-populates the right number of
     * pending rows.
     */
    const { expectedModelRequests, alreadyIncluded } =
      await deriveBookingScanSession({
        modelRequests: booking.modelRequests,
        bookingAssets: booking.bookingAssets,
        organizationId,
      });

    if (expectedModelRequests.length === 0) {
      return redirect(`/bookings/${bookingId}`);
    }

    /**
     * Whether submit sends out only the scanned items, decided the same way
     * `fulfilAndCheckOut` decides it: under the explicit check-out requirement,
     * or once the booking is no longer RESERVED.
     */
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    const checksOutScannedOnly =
      isExplicitScanRequired({
        access,
        settings: bookingSettings,
        direction: "checkout",
      }) || booking.status !== BookingStatus.RESERVED;

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
      checksOutScannedOnly,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * Action for the fulfil-and-checkout route.
 *
 * Parses the drawer-submitted payload and delegates to
 * `fulfilAndCheckOut`, which materialises the requests into
 * `BookingAsset` rows and then checks the booking out — the whole
 * booking, or, under the workspace's explicit check-out requirement,
 * only the scanned units — before redirecting back to the booking page
 * on success.
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

    // `checkout`, not `update`: BASE holds `update` and deliberately does NOT
    // hold `checkout`, so gating on `update` let a BASE user check out through
    // this route. The dedicated action exists precisely to withhold this.
    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.checkout,
    });

    const formData = await request.formData();

    const { assetIds, kitIds, checkoutIntentChoice } = parseData(
      formData,
      fulfilAndCheckoutSchema
    );

    /**
     * Pull the booking's from/to for the full check-out's pre-tx conflict
     * guard (mirrors the existing `checkoutBooking` caller in
     * `bookings.$bookingId.overview.tsx`).
     */
    const basicBookingInfo = await db.booking.findUniqueOrThrow({
      where: { id: bookingId, organizationId },
      // creatorId/custodianUserId feed the ownership guard below.
      select: {
        from: true,
        to: true,
        creatorId: true,
        custodianUserId: true,
      },
    });

    // A direct POST skips the loader, so the action repeats the ownership
    // check. SELF_SERVICE holds `booking:checkout`, and `fulfilAndCheckOut`
    // does not check ownership itself. No-op when `access.bookings.writeAll`.
    // Mirrors api+/mobile+/bookings.fulfil-and-checkout.ts.
    validateBookingOwnership({
      booking: basicBookingInfo,
      userId,
      access,
      action: "check out",
    });

    // Decided after the booking and ownership checks, so a missing or foreign
    // booking answers as such. Under the requirement only the scanned units
    // are checked out.
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    const requireExplicitCheckout = isExplicitScanRequired({
      access,
      settings: bookingSettings,
      direction: "checkout",
    });

    const { remainingAssetCount } = await fulfilAndCheckOut({
      bookingId,
      organizationId,
      userId,
      assetIds,
      kitIds,
      checkoutIntentChoice,
      hints: getClientHint(request),
      from: basicBookingInfo.from,
      to: basicBookingInfo.to,
      requireExplicitCheckout,
    });

    sendNotification({
      title: "Checked out",
      message:
        remainingAssetCount > 0
          ? `The scanned units are checked out. ${remainingAssetCount} more ${
              remainingAssetCount === 1 ? "asset is" : "assets are"
            } still to check out.`
          : "Your booking has been checked out successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/bookings/${bookingId}`);
  } catch (cause) {
    // `error()` also sends the refusal to this user as an error notification.
    // That toast is how a refused check-out reaches the operator in the drawer.
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
 * `FulfilReservationsDrawer`; this component is intentionally a
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
  // drawer also reads `useLoaderData` directly for its own
  // rendering — that's fine; `useLoaderData` dedupes via the router
  // context.
  const {
    booking,
    expectedModelRequests,
    alreadyIncluded,
    checksOutScannedOnly,
  } = useLoaderData<typeof loader>();

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
      bookingStatus: booking.status,
      checksOutScannedOnly,
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
