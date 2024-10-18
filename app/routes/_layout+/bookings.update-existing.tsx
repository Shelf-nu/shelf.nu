import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { PenIcon } from "~/components/icons/library";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";

import { getBookings, upsertBooking } from "~/modules/booking/service.server";
import { createNotes } from "~/modules/note/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
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
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
export async function loader({ context, request }: LoaderFunctionArgs) {
  const searchParams = getCurrentSearchParams(request);
  const ids = searchParams.getAll("id");
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    const { organizationId, currentOrganization, isSelfServiceOrBase } =
      await requirePermission({
        userId: authSession?.userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.create,
      });

    if (isPersonalOrg(currentOrganization)) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You can't create bookings for personal workspaces. Please create a Team workspace to create bookings.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }
    /**
     * We need to fetch the team members to be able to display them in the custodian dropdown.
     */
    const teamMembers = await db.teamMember.findMany({
      where: {
        deletedAt: null,
        organizationId,
      },
      include: {
        user: true,
      },
      orderBy: {
        userId: "asc",
      },
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, search, tab } = getParamsValues(searchParams);
    const perPage = 20;
    const { bookings, bookingCount } = await getBookings({
      organizationId,
      page,
      perPage,
      search,
      userId: authSession?.userId,
      // If status is in the params, we filter based on it
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
    const selfServiceOrBaseUser = isSelfServiceOrBase
      ? teamMembers.find((member) => member.userId === authSession.userId)
      : undefined;

    if (isSelfServiceOrBase && !selfServiceOrBaseUser) {
      throw new ShelfError({
        cause: null,
        message:
          "Seems like something is wrong with your user. Please contact support to get this resolved. Make sure to include the trace id seen below.",
        label: "Booking",
      });
    }

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
        tab,
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

const getBookingDetails = async (
  bookingId: string
): Promise<{ id: string; status: string; assets: { id: string }[] } | null> => {
  const booking = await db.booking.findFirst({
    where: { id: bookingId },
    select: { id: true, status: true, assets: { select: { id: true } } },
  });

  if (!booking) {
    throw new ShelfError({
      cause: null,
      message: "No booking found. Contact support.",
      label: "Booking",
    });
  }

  if (!["DRAFT", "RESERVED"].includes(booking.status!)) {
    throw new ShelfError({
      cause: null,
      message: "Booking is not in Draft or Reserved status.",
      label: "Booking",
    });
  }
  return booking;
};

const getKitAssets = async (kitIds: string[]): Promise<string[]> => {
  const selectedKits = await db.kit.findMany({
    where: { id: { in: kitIds } },
    select: { assets: { select: { id: true, status: true } } },
  });

  const allAssets = selectedKits.flatMap((kit) => kit.assets);

  if (allAssets.some((asset) => asset.status === "CHECKED_OUT")) {
    throw new Error(
      "One or more assets are already checked out in the kit, so they cannot be added to the booking."
    );
  }

  return allAssets.map((asset) => asset.id);
};

const getAvailableAssets = async (assetIds: string[]): Promise<string[]> => {
  const selectedAssets = await db.asset.findMany({
    where: { id: { in: assetIds }, status: "AVAILABLE" },
    select: { status: true, id: true, kit: true },
  });

  if (selectedAssets.some((asset) => asset.kit)) {
    throw new ShelfError({
      cause: null,
      message: "Cannot add assets that belong to a kit.",
      label: "Booking",
    });
  }

  return selectedAssets.map((asset) => asset.id);
};

const processBooking = async (
  tab: string,
  bookingId: string,
  assetIds: string[] | undefined,
  kitIds: string[] | undefined
) => {
  let finalAssetIds: string[] = [];
  let booking;
  if (tab === "kits" && kitIds && kitIds.length > 0) {
    const promises = [getKitAssets(kitIds), getBookingDetails(bookingId)];
    const [assetIdsFromKits, bookingDetails] = await Promise.all(promises);

    finalAssetIds = assetIdsFromKits as string[];
    booking = bookingDetails;
  } else if (tab === "assets" && assetIds && assetIds.length > 0) {
    const promises = [
      getAvailableAssets(assetIds),
      getBookingDetails(bookingId),
    ];
    const [assetIdsFromAssets, bookingDetails] = await Promise.all(promises);

    finalAssetIds = assetIdsFromAssets as string[];
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
    bookingInfo: booking as {
      id: string;
      status: string;
      assets: { id: string }[];
    },
  };
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
    const { assetIds, bookingId, tab, kitIds } = parseData(
      formData,
      z.object({
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
        tab: z.string().transform((val, ctx) => {
          if (!val && val === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Please select a custodian",
            });
            return z.NEVER;
          }
          return val;
        }),
        kitIds: z.array(z.string()).optional(),
      }),
      {
        additionalData: { userId },
        message: "Please select a Booking",
      }
    );

    if (!assetIds?.length && !bookingId?.length) {
      redirect(`/bookings/${bookingId}`);
    }

    const { finalAssetIds, bookingInfo } = await processBooking(
      tab,
      bookingId,
      assetIds,
      kitIds
    );

    function intersected(arr1: string[], arr2: string[]): boolean {
      return !!arr1.find((value) =>
        arr2.find((innerValue) => innerValue?.toString() == value?.toString())
      );
    }

    const bookingAssets = (bookingInfo ? bookingInfo.assets : []).map(
      (asset) => asset.id
    );

    if (bookingAssets.length > 0 && intersected(bookingAssets, finalAssetIds)) {
      throw new ShelfError({
        cause: null,
        message: `Booking already contains ${tab}`,
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
  const { ids, tab, hints } = useLoaderData<typeof loader>();
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
    <>
      <Form method="post">
        <div className="modal-content-wrapper">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
            <PenIcon />
          </div>
          <div className="mb-5">
            <h3>Add to Existing Booking</h3>
            <p>You can only add an asset to bookings that</p>
            <p>are in Draft or Reserved State.</p>
          </div>
          {tab === "assets" &&
            ids?.map((item, i) => (
              <input
                key={item}
                type="hidden"
                name={`assetIds[${i}]`}
                value={item}
              />
            ))}
          {tab === "kits" &&
            ids?.map((kitId, i) => (
              <input
                key={kitId}
                type="hidden"
                name={`kitIds[${i}]`}
                value={kitId}
              />
            ))}
          <input key="tab" type="hidden" name="tab" value={tab} />

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
                    className="flex flex-col gap-1 text-black"
                    key={item.id || item.name}
                  >
                    <h3 className="max-w-[250px] truncate">{item.name}</h3>
                    <p>
                      {item.displayFrom} - {item.displayTo}
                    </p>
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
            <Button
              to=".."
              variant="secondary"
              width="full"
              disabled={disabled}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              width="full"
              name="intent"
              type={`Add${tab}`}
              disabled={disabled}
            >
              Confirm
            </Button>
          </div>
        </div>
      </Form>
    </>
  );
}
