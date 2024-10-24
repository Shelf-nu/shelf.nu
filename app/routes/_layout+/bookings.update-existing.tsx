import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import styles from "~/components/booking/styles.update-existing.css?url";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { BookingExistIcon } from "~/components/icons/library";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import { getAvailableAssetsForBooking } from "~/modules/asset/service.server";

import {
  getBookings,
  getExistingBookingDetails,
  upsertBooking,
} from "~/modules/booking/service.server";
import { getAvailableKitAssetForBooking } from "~/modules/kit/service.server";
import { createNotes } from "~/modules/note/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import {
  getClientHint,
  getDateTimeFormat,
  getDateTimeFormatFromHints,
} from "~/utils/client-hints";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";

import {
  data,
  error,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { intersected } from "~/utils/utils";

const updateBookingSchema = z.object({
  assetIds: z.array(z.string()).optional(),
  bookingId: z.string().transform((val, ctx) => {
    if (!val && val === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please select a custodian",
      });
      return z.NEVER;
    }
    return val;
  }),
  indexType: z.string().transform((val, ctx) => {
    if (!val && val === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid operation. Please contact support.",
      });
      return z.NEVER;
    }
    return val;
  }),
  kitIds: z.array(z.string()).optional(),
});

export async function loader({ context, request }: LoaderFunctionArgs) {
  const searchParams = getCurrentSearchParams(request);
  const ids = searchParams.getAll("id");
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, search, indexType } = getParamsValues(searchParams);
    const perPage = 20;
    const { bookings, bookingCount } = await getBookings({
      organizationId,
      page,
      perPage,
      search,
      userId: authSession?.userId,
      statuses: ["DRAFT", "RESERVED"],
      ...(isSelfServiceOrBase && {
        // If the user is self service, we only show bookings that belong to that user)
        custodianUserId: authSession?.userId,
      }),
    });

    const header: HeaderData = {
      title: "Bookings",
    };

    const modelName = {
      singular: "booking",
      plural: "bookings",
    };

    const totalPages = Math.ceil(bookingCount / perPage);

    const hints = getClientHint(request);

    const items = bookings.map((b) => {
      if (b.from && b.to) {
        const from = new Date(b.from);
        const displayFrom = getDateTimeFormat(request, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(from);

        const to = new Date(b.to);
        const displayTo = getDateTimeFormat(request, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(to);

        return {
          ...b,
          displayFrom: displayFrom.split(","),
          displayTo: displayTo.split(","),
          metadata: {
            ...b,
            displayFrom: displayFrom.split(","),
            displayTo: displayTo.split(","),
          },
        };
      }
      return b;
    });
    return json(
      data({
        showModal: true,
        header,
        bookings: items,
        search,
        page,
        bookingCount: bookingCount,
        totalPages,
        perPage,
        modelName,
        ids: ids.length ? ids : undefined,
        indexType,
        hints,
      }),
      {
        headers: [
          setCookie(await setSelectedOrganizationIdCookie(organizationId)),
        ],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

const processBooking = async (
  indexType: string,
  bookingId: string,
  assetIds: string[] | undefined,
  kitIds: string[] | undefined
) => {
  try {
    let finalAssetIds: string[] = [];
    let booking;
    if (indexType === "kits" && kitIds && kitIds.length > 0) {
      const promises = [
        getAvailableKitAssetForBooking(kitIds),
        getExistingBookingDetails(bookingId),
      ];
      const [assetIdsFromKits, bookingDetails] = await Promise.all(promises);

      finalAssetIds = assetIdsFromKits as string[];
      booking = bookingDetails;
    } else if (indexType === "assets" && assetIds && assetIds.length > 0) {
      const promises = [
        getAvailableAssetsForBooking(assetIds),
        getExistingBookingDetails(bookingId),
      ];

      const [assets, bookingDetails] = await Promise.all(promises);
      finalAssetIds = assets as string[];
      booking = bookingDetails;
    } else {
      throw new ShelfError({
        cause: null,
        message: "Invalid operation. Please contact support.",
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
  } catch (cause:any) {
    throw new ShelfError({
      cause: cause,
      message: cause?.message || "Something went wrong while processing the booking.",
      label: "Booking",
    });
  }
};

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });
    const formData = await request.formData();
    const { assetIds, bookingId, indexType, kitIds } = parseData(
      formData,
      updateBookingSchema,
      {
        additionalData: { userId },
        message: "Please select a Booking",
      }
    );

    if (!assetIds?.length && !bookingId?.length) {
      redirect(`/bookings/${bookingId}`);
    }

    const { finalAssetIds, bookingInfo } = await processBooking(
      indexType,
      bookingId,
      assetIds,
      kitIds
    );

    const bookingAssets = (
      "assets" in bookingInfo ? bookingInfo.assets : []
    ).map((asset) => asset.id);

    if (bookingAssets.length > 0 && intersected(bookingAssets, finalAssetIds)) {
      throw new ShelfError({
        cause: null,
        message: `Booking already contains ${indexType}`,
        label: "Booking",
      });
    }
    const user = await getUserByID(authSession.userId);

    const booking = await upsertBooking(
      {
        id: bookingId,
        assetIds: finalAssetIds,
      },
      getClientHint(request)
    );
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

    return redirect(`/bookings/${bookingId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export const handle = {
  name: "bookings.update-existing",
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function ExistingBooking() {
  const { ids, indexType, hints } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  function isValidBooking(booking: any) {
    return booking && ["RESERVED", "DRAFT"].includes(booking.status);
  }

  function formatDate(date: Date) {
    if (!date) {
      return null;
    }
    return getDateTimeFormatFromHints(hints, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(date));
  }

  return (
    <Form method="post">
      <div>
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
          <BookingExistIcon />
        </div>
        <div className="mb-5">
          <h3>Add to Existing Booking</h3>
          <div>
            You can only add an asset to bookings that are in Draft or Reserved
            State.
          </div>
        </div>
        {indexType === "assets" &&
          ids?.map((item, i) => (
            <input
              key={item}
              type="hidden"
              name={`assetIds[${i}]`}
              value={item}
            />
          ))}
        {indexType === "kits" &&
          ids?.map((kitId, i) => (
            <input
              key={kitId}
              type="hidden"
              name={`kitIds[${i}]`}
              value={kitId}
            />
          ))}
        <input
          key="indexType"
          type="hidden"
          name="indexType"
          value={indexType}
        />

        <div className=" relative z-50 mb-2">
          <DynamicSelect
            model={{
              name: "booking",
              queryKey: "name",
              // we can achieve it using this also. currently it is accepting only one status value.
              // status: ['DRAFT', 'RESERVED']
            }}
            fieldName="bookingId"
            contentLabel=" Existing Bookings"
            initialDataKey="bookings"
            countKey="bookingCount"
            placeholder="Select a Booking"
            allowClear
            closeOnSelect
            required={true}
            transformItem={(item) => ({
              ...item,
              displayFrom: formatDate(item?.metadata?.from),
              displayTo: formatDate(item?.metadata?.to),
              status: item?.metadata?.status,
            })}
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
                    {item.displayFrom} - {item.displayTo}
                  </div>
                </div>
              ) : null
            }
          />
          <div className="mt-2 text-gray-500">
            Only Draft and Reserved Bookings Shown
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
            type={`Add${indexType}`}
            disabled={disabled}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Form>
  );
}
