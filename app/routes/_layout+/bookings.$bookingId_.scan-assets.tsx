import { useEffect, useState } from "react";
import type { Asset } from "@prisma/client";
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { json } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { AssetLabel } from "~/components/icons/library";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { ListHeader } from "~/components/list/list-header";
import { Button } from "~/components/shared/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTrigger,
} from "~/components/shared/drawer";
import { Spinner } from "~/components/shared/spinner";
import { Table, Th } from "~/components/table";
import When from "~/components/when/when";
import { ZXingScanner } from "~/components/zxing-scanner";
import { useClientNotification } from "~/hooks/use-client-notification";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import { useQrScanner } from "~/hooks/use-qr-scanner";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { getBooking } from "~/modules/booking/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { userPrefs } from "~/utils/cookies.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

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

    // Self service can only manage assets for bookings that are DRAFT
    const canManageAssetsAsSelfService =
      isSelfService && booking.status !== BookingStatus.DRAFT;

    const isCompleted = booking.status === BookingStatus.COMPLETE;
    const isArchived = booking.status === BookingStatus.ARCHIVED;

    const canManageAssets =
      !!booking.from &&
      !!booking.to &&
      !isCompleted &&
      !isArchived &&
      !canManageAssetsAsSelfService;

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

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "single",
};

export default function ScanAssetsForBookings() {
  const { booking } = useLoaderData<typeof loader>();

  const [fetchedAssets, setFetchedAssets] = useState<Asset[]>([]);

  const fetcher = useFetcherWithReset<{ asset: Asset }>();
  const [sendNotification] = useClientNotification();

  const { videoMediaDevices } = useQrScanner();
  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 140 : vh - 167;

  function handleQrDetectionSuccess(qrId: string) {
    sendNotification({
      title: "Shelf's QR Code detected",
      message: "Fetching mapped asset details...",
      icon: { name: "success", variant: "success" },
    });

    fetcher.submit(
      { qrId, bookingId: booking.id },
      { method: "POST", action: "/api/bookings/get-scanned-asset" }
    );
  }

  useEffect(
    function handleFetcherSuccess() {
      if (fetcher.data && fetcher.data?.asset) {
        setFetchedAssets((prev) => [...prev, fetcher.data.asset]);
        fetcher.reset();
      }
    },
    [fetcher, fetcher.data]
  );

  return (
    <>
      <Header hidePageDescription />

      <Drawer>
        <DrawerTrigger>
          <Button>View assets</Button>
        </DrawerTrigger>

        <DrawerContent className="min-h-[600px] max-w-[800px] overflow-y-auto md:min-h-[800px]">
          <div className="mx-auto size-full md:max-w-4xl">
            <DrawerHeader className="border-b text-left">
              <DrawerDescription>
                {fetchedAssets.length} assets scanned
              </DrawerDescription>
            </DrawerHeader>

            <When truthy={fetchedAssets.length === 0}>
              <div className="my-16 flex flex-col items-center px-3 text-center">
                <div className="mb-4 rounded-full bg-primary-50  p-2">
                  <div className=" rounded-full bg-primary-100 p-2 text-primary">
                    <AssetLabel className="size-6" />
                  </div>
                </div>

                <div>
                  <div className="text-base font-semibold text-gray-900">
                    List is empty
                  </div>
                  <p className="text-sm text-gray-600">
                    Fill list by scanning codes...
                  </p>
                </div>
              </div>
            </When>

            <When truthy={fetchedAssets.length > 0}>
              <Table>
                <ListHeader hideFirstColumn>
                  <Th>Name</Th>
                </ListHeader>
              </Table>
            </When>

            <When truthy={fetchedAssets.length > 0}>
              <DrawerFooter className="">
                <Button className="w-full max-w-full">Submit</Button>
                <DrawerClose asChild>
                  <Button variant="outline" className="w-full max-w-full">
                    Close
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </When>
          </div>
        </DrawerContent>
      </Drawer>

      <div className="-mx-4 flex flex-col" style={{ height: `${height}px` }}>
        {videoMediaDevices && videoMediaDevices.length > 0 ? (
          <ZXingScanner
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
