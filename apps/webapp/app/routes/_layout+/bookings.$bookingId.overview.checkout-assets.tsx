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
import PartialCheckoutDrawer from "~/components/scanner/drawer/uses/partial-checkout-drawer";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import {
  checkoutAssets,
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
