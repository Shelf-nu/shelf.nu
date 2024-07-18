import { useState } from "react";
import { OrganizationRoles } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";
import {
  addScannedQrIdAtom,
  removeScannedQrIdAtom,
  scannedQrIdsAtom,
  setFetchedScannedAssetAtom,
} from "~/atoms/bookings";
import ScannedAssetsDrawer, {
  addScannedAssetsToBookingSchema,
} from "~/components/booking/scanned-assets-drawer";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Spinner } from "~/components/shared/spinner";
import { ZXingScanner } from "~/components/zxing-scanner";
import { useClientNotification } from "~/hooks/use-client-notification";
import { useQrScanner } from "~/hooks/use-qr-scanner";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import {
  addScannedAssetsToBooking,
  getBooking,
} from "~/modules/booking/service.server";
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
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import type { AssetWithBooking } from "./bookings.$bookingId.add-assets";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const booking = await getBooking({
      id: bookingId,
      organizationId: organizationId,
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
  breadcrumb: () => "single",
};

export default function ScanAssetsForBookings() {
  const { booking } = useLoaderData<typeof loader>();

  const [isFetchingAsset, setIsFetchingAsset] = useState(false);

  const fetchedQrIds = useAtomValue(scannedQrIdsAtom);
  const addScannedQrId = useSetAtom(addScannedQrIdAtom);
  const removeScannedQrId = useSetAtom(removeScannedQrIdAtom);

  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const setFetchedScannedAsset = useSetAtom(setFetchedScannedAssetAtom);

  const [sendNotification] = useClientNotification();

  const { videoMediaDevices } = useQrScanner();
  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 140 : vh - 100;

  async function handleQrDetectionSuccess(qrId: string) {
    setIsFetchingAsset(true);

    /**
     * If a qrId is already fetched then we don't have to fetch it again otherwise it will cause to fetch asset infinitely
     * */
    if (fetchedQrIds.includes(qrId)) {
      /** For now i comment it.
       * @TODO I think we shouldnt use the notifications here, but come up with something that works locally inside the scanner(see designs)
       */
      // sendNotification({
      //   title: "Already added",
      //   icon: { name: "x", variant: "error" },
      // });
      return;
    }

    addScannedQrId(qrId);

    try {
      const response = await fetch(
        `/api/bookings/get-scanned-asset?qrId=${qrId}&bookingId=${booking.id}`
      );
      const { asset } = await response.json();
      setFetchedScannedAsset(asset as AssetWithBooking);
      /** @TODO see comment above, same thing */
      // sendNotification({
      //   title: "Asset scanned",
      //   message: "Asset is scanned and successfully added to the list.",
      //   icon: { name: "success", variant: "success" },
      // });
    } catch {
      removeScannedQrId(qrId);
    } finally {
      setIsFetchingAsset(false);
    }
  }

  return (
    <>
      <Header hidePageDescription />

      <ScannedAssetsDrawer isLoading={isLoading || isFetchingAsset} />

      <div className="-mx-4 flex flex-col" style={{ height: `${height}px` }}>
        {videoMediaDevices && videoMediaDevices.length > 0 ? (
          <ZXingScanner
            isLoading={isFetchingAsset || isLoading}
            videoMediaDevices={videoMediaDevices}
            onQrDetectionSuccess={handleQrDetectionSuccess}
          />
        ) : (
          <div className="mt-4 flex h-full flex-col items-center justify-center">
            <Spinner /> Waiting for permission to access camera.
          </div>
        )}
      </div>
    </>
  );
}
