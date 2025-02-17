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
import ScannedAssetsDrawer, {
  addScannedAssetsToBookingSchema,
} from "~/components/scanner/drawer";
import { WasmScanner } from "~/components/zxing-scanner/wasm-scanner";
import { useVideoDevices } from "~/hooks/use-video-devices";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import {
  addScannedAssetsToBooking,
  getBooking,
} from "~/modules/booking/service.server";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { canUserManageBookingAssets } from "~/utils/bookings";
import { userPrefs } from "~/utils/cookies.server";
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
          "You are not allowed to manage assets for this booking at the moment.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    /** We get the userPrefs cookie so we can see if there is already a default camera */
    const cookieHeader = request.headers.get("Cookie");
    const cookie = (await userPrefs.parse(cookieHeader)) || {};

    const header: HeaderData = {
      title: `Scan assets for booking | ${booking.name}`,
    };

    return json(
      data({ header, booking, scannerCameraId: cookie.scannerCameraId })
    );
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
      action: PermissionAction.update,
    });

    const formData = await request.formData();

    const { assetIds } = parseData(formData, addScannedAssetsToBookingSchema);

    await addScannedAssetsToBooking({ bookingId, assetIds, organizationId });

    sendNotification({
      title: "Assets added",
      message: "All the scanned assets has been successfully added to booking.",
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
  breadcrumb: () => "Scan QR codes to add to booking",
  name: "booking.scan-assets",
};

export default function ScanAssetsForBookings() {
  const addItem = useSetAtom(addScannedItemAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const { devices, DevicesPermissionComponent } = useVideoDevices();
  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 140 : vh - 100;

  function handleQrDetectionSuccess(qrId: string, error?: string) {
    /** WE send the error to the item. addItem will automatically handle the data based on its value */
    addItem(qrId, error);
  }

  return (
    <>
      <Header hidePageDescription />

      <ScannedAssetsDrawer isLoading={isLoading} />

      <div className="-mx-4 flex flex-col" style={{ height: `${height}px` }}>
        {devices ? (
          <WasmScanner
            isLoading={isLoading}
            devices={devices}
            onQrDetectionSuccess={handleQrDetectionSuccess}
            backButtonText="Booking"
            allowNonShelfCodes
            continuousScanning={true}
          />
        ) : (
          <DevicesPermissionComponent />
        )}
      </div>
    </>
  );
}
