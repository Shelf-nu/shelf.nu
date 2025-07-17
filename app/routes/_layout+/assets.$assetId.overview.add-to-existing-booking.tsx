import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { CalendarCheck } from "lucide-react";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { Button } from "~/components/shared/button";

import {
  loadBookingsData,
  processBooking,
  updateBookingAssets,
} from "~/modules/booking/service.server";
import { createNotes } from "~/modules/note/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";

import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { intersected } from "~/utils/utils";

const updateBookingSchema = z.object({
  assetIds: z.string().array().min(1, "At least one asset is required."),
  bookingId: z.string().min(1, "Please select a booking."),
});

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const loaderData = await loadBookingsData({
      request,
      organizationId,
      userId: authSession?.userId,
      isSelfServiceOrBase,
      ids: assetId ? [assetId] : undefined,
    });

    return json(data(loaderData), {
      headers: [
        setCookie(await setSelectedOrganizationIdCookie(organizationId)),
      ],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });
    const formData = await request.formData();
    const { assetIds, bookingId } = parseData(formData, updateBookingSchema, {
      additionalData: { userId },
      message: "Please select a Booking",
      shouldBeCaptured: false,
    });

    const { finalAssetIds, bookingInfo } = await processBooking(
      bookingId,
      assetIds
    );

    const bookingAssets = (
      "assets" in bookingInfo ? bookingInfo.assets : []
    ).map((asset) => asset.id);

    if (bookingAssets.length > 0 && intersected(bookingAssets, finalAssetIds)) {
      throw new ShelfError({
        cause: null,
        message: `The booking you have selected already contains the asset you are trying to add. Please select a different booking.`,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }
    const user = await getUserByID(authSession.userId);

    const booking = await updateBookingAssets({
      id: bookingId,
      organizationId,
      assetIds: finalAssetIds,
    });

    await createNotes({
      content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** added asset to booking **[${
        booking.name
      }](/bookings/${booking.id})**.`,
      type: "UPDATE",
      userId: authSession.userId,
      assetIds: finalAssetIds,
    });

    sendNotification({
      title: "Booking Updated",
      message: "Your booking has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/assets/${params.assetId}/overview`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function ExistingBooking() {
  const { ids } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  function isValidBooking(booking: any) {
    return booking && ["RESERVED", "DRAFT"].includes(booking.status);
  }

  return (
    <Form method="post">
      <div className="modal-content-wrapper">
        <div className="bg-primary-100 mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 p-2 text-primary-600">
          <CalendarCheck />
        </div>
        <div className="mb-5">
          <h3>Add to Existing Booking</h3>
          <div>
            You can only add an asset to bookings that are in Draft or Reserved
            State.
          </div>
        </div>
        {ids?.map((item, i) => (
          <input
            key={item}
            type="hidden"
            name={`assetIds[${i}]`}
            value={item}
          />
        ))}

        <div className=" relative z-50 mb-2">
          <DynamicSelect
            model={{
              name: "booking",
              queryKey: "name",
              // we can achieve it using this also. currently it is accepting only one status value.
              // status: ['DRAFT', 'RESERVED']
            }}
            fieldName="bookingId"
            contentLabel="Existing Bookings"
            initialDataKey="bookings"
            countKey="bookingCount"
            placeholder="Select a Booking"
            allowClear
            closeOnSelect
            required={true}
            renderItem={(item: any) =>
              isValidBooking(item) ? (
                <div
                  className="flex flex-col items-start gap-1 text-black"
                  key={item.id || item.name}
                >
                  <div className="semi-bold max-w-[250px] truncate text-[16px]">
                    {item.name}
                  </div>
                  <div className="text-sm">
                    {item.displayFrom} - {item.displayTo}
                  </div>
                </div>
              ) : null
            }
          />
          <div className="mt-2 text-color-500">
            Only <span className="font-medium text-color-600">Draft</span> and{" "}
            <span className="font-medium text-color-600">Reserved</span>{" "}
            bookings Shown
          </div>
        </div>
        {actionData?.error && (
          <div>
            <div className="text-red-500">
              {actionData?.error?.message || ""}
            </div>
          </div>
        )}

        <div className="mb-8"></div>
        <div className="flex gap-3">
          <Button to=".." variant="secondary" width="full" disabled={disabled}>
            Cancel
          </Button>
          <Button
            variant="primary"
            width="full"
            name="intent"
            type={`Add Assets`}
            disabled={disabled}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Form>
  );
}
