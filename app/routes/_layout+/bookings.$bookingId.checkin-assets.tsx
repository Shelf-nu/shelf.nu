import { OrganizationRoles } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "@remix-run/node";
import { useNavigation } from "@remix-run/react";
import { useSetAtom } from "jotai";
import { z } from "zod";
import { addScannedItemAtom } from "~/atoms/qr-scanner";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { CodeScanner } from "~/components/scanner/code-scanner";
import PartialCheckinDrawer, {
  partialCheckinAssetsSchema,
} from "~/components/scanner/drawer/uses/partial-checkin-drawer";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import {
  getBooking,
  getDetailedPartialCheckinData,
  partialCheckinBooking,
} from "~/modules/booking/service.server";
import { calculatePartialCheckinProgress } from "~/modules/booking/utils.server";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { canUserManageBookingAssets } from "~/utils/bookings";
import { getClientHint } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  assertIsPost,
  data,
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

    const canManageAssets = canUserManageBookingAssets(booking, isSelfService);

    if (!canManageAssets) {
      throw new ShelfError({
        cause: null,
        message:
          "You cannot check in assets for this booking at the moment. The booking may not be ongoing or you may not have permission to manage its assets.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    // Check if there might be partial check-ins by looking at asset statuses
    const hasAvailableAssets = booking.assets.some(
      (asset) => asset.status === "AVAILABLE"
    );

    // Only fetch partial check-in data if there might be partial check-ins
    const { checkedInAssetIds } = hasAvailableAssets
      ? await getDetailedPartialCheckinData(booking.id)
      : { checkedInAssetIds: [] as string[] };

    // Calculate partial check-in progress
    const partialCheckinProgress = calculatePartialCheckinProgress(
      booking.assets.length,
      checkedInAssetIds
    );

    const title = `Scan assets to check in | ${booking.name}`;
    const header: HeaderData = {
      title,
    };

    return json(data({ title, header, booking, partialCheckinProgress }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw json(error(reason), { status: reason.status });
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
    const { assetIds } = parseData(formData, partialCheckinAssetsSchema);
    const hints = getClientHint(request);

    await partialCheckinBooking({
      id: bookingId,
      organizationId,
      assetIds,
      userId,
      hints,
    });

    sendNotification({
      title: "Assets checked in",
      message: `Successfully checked in ${assetIds.length} asset${
        assetIds.length > 1 ? "s" : ""
      } from booking.`,
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/bookings/${bookingId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Scan QR codes to check in",
  name: "booking.checkin-assets",
};

export default function CheckinAssetsFromBooking() {
  const addItem = useSetAtom(addScannedItemAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 67 : vh - 100;

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
          allowNonShelfCodes
          paused={false}
          setPaused={() => {}}
          scannerModeClassName={(mode) =>
            tw(mode === "scanner" && "justify-start pt-[100px]")
          }
        />
      </div>
    </>
  );
}
