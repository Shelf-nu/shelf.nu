import type { Prisma } from "@prisma/client";
import { CalendarCheck } from "lucide-react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";

import {
  getExistingBookingDetails,
  loadBookingsData,
  updateBookingAssets,
} from "~/modules/booking/service.server";
import { getAvailableKitAssetForBooking } from "~/modules/kit/service.server";
import { createNotes } from "~/modules/note/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { intersected } from "~/utils/utils";

const updateBookingSchema = z.object({
  bookingId: z.string().transform((val, ctx) => {
    if (!val && val === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please select a booking",
      });
      return z.NEVER;
    }
    return val;
  }),
  kitIds: z.array(z.string()).optional(),
});

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
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
      ids: kitId ? [kitId] : undefined,
    });

    return data(payload(loaderData), {
      headers: [
        setCookie(await setSelectedOrganizationIdCookie(organizationId)),
      ],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

const processBooking = async (
  bookingId: string,
  kitIds: string[] | undefined
) => {
  try {
    let finalAssetIds: string[] = [];
    let booking;
    if (kitIds && kitIds.length > 0) {
      const promises = [
        getAvailableKitAssetForBooking(kitIds),
        getExistingBookingDetails(bookingId),
      ];

      const [assets, bookingDetails] = await Promise.all(promises);
      finalAssetIds = assets as string[];
      booking = bookingDetails;
    } else {
      throw new ShelfError({
        cause: null,
        message: "Invalid operation.",
        label: "Booking",
      });
    }

    if (finalAssetIds.length === 0) {
      throw new ShelfError({
        cause: null,
        message: "No assets available.",
        label: "Booking",
      });
    }

    return {
      finalAssetIds,
      bookingInfo: booking,
    };
  } catch (cause: any) {
    throw new ShelfError({
      cause: cause,
      message:
        cause?.message || "Something went wrong while processing the booking.",
      label: "Booking",
    });
  }
};

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
    const { kitIds, bookingId } = parseData(formData, updateBookingSchema, {
      additionalData: { userId },
      message: "Please select a Booking",
      shouldBeCaptured: false,
    });

    if (!kitIds?.length && !bookingId?.length) {
      throw new ShelfError({
        cause: null,
        message: `No kitIds found or booking not found.`,
        label: "Booking",
      });
    }

    const { finalAssetIds, bookingInfo } = await processBooking(
      bookingId,
      kitIds
    );

    const bookingAssets = (
      "assets" in bookingInfo ? bookingInfo.assets : []
    ).map((asset) => asset.id);

    if (bookingAssets.length > 0 && intersected(bookingAssets, finalAssetIds)) {
      throw new ShelfError({
        cause: null,
        message: `The booking you have selected already contains the kit you are trying to add. Please select a different booking.`,
        label: "Booking",
      });
    }
    const user = await getUserByID(authSession.userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Prisma.UserSelect,
    });

    const booking = await updateBookingAssets({
      id: bookingId,
      organizationId,
      assetIds: finalAssetIds,
      userId,
    });

    const actor = wrapUserLinkForNote({
      id: authSession.userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });
    const bookingLink = wrapLinkForNote(
      `/bookings/${booking.id}`,
      booking.name.trim()
    );
    await createNotes({
      content: `${actor} added asset to ${bookingLink}.`,
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

    return redirect(`/kits/${params.kitId}/assets`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
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
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
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
          <input key={item} type="hidden" name={`kitIds[${i}]`} value={item} />
        ))}

        <div className=" relative z-50 mb-2">
          <DynamicSelect
            model={{
              name: "booking",
              queryKey: "name",
            }}
            fieldName="bookingId"
            contentLabel=" Existing Bookings"
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
                  <div className="text-[14px]">
                    <DateS date={item.from} includeTime /> -{" "}
                    <DateS date={item.to} includeTime />
                  </div>
                </div>
              ) : null
            }
          />
          <div className="mt-2 text-gray-500">
            Only <span className="font-medium text-gray-600">Draft</span> and{" "}
            <span className="font-medium text-gray-600">Reserved</span> bookings
            are visible
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
