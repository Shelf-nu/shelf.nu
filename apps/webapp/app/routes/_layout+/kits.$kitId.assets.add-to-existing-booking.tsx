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
  assertKitsAddableToActiveBooking,
  buildKitSlicesForBooking,
  getExistingBookingDetails,
  loadBookingsData,
  updateBookingAssets,
} from "~/modules/booking/service.server";
import { createNotes } from "~/modules/note/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
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

export const meta = () => [{ title: appendToMetaTitle("Add kit to booking") }];

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

/**
 * Adds the currently-viewed kit (or kits, via the hidden `kitIds[]` inputs) to
 * an existing DRAFT/RESERVED booking.
 *
 * Kit members are added as **kit-driven** `BookingAsset` rows (each carrying the
 * originating `AssetKit.id` on `assetKitId`) — NOT as standalone rows. The
 * booking overview groups rows by `assetKitId`, so writing members through the
 * standalone `assetIds` bucket (the previous bug) produced loose rows with a
 * NULL `assetKitId` and silently dropped the kit grouping. Slice resolution is
 * delegated to the shared `buildKitSlicesForBooking` helper so this flow,
 * `createBooking`, and the manage-kits route all build slices the same,
 * org-scoped way.
 */
export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, role } = await requirePermission({
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

    if (!kitIds || kitIds.length === 0) {
      throw new ShelfError({
        cause: null,
        message: `No kits found to add to the booking.`,
        status: 400,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    // Validate the target booking: confirms it exists in the caller's org and
    // is in an addable state (DRAFT/RESERVED/ONGOING/OVERDUE). Also returns the
    // existing BookingAsset rows so we can skip kit slices that are already
    // present. `updateBookingAssets` re-checks existence but NOT status, so this
    // guard is what blocks adding to a terminal (COMPLETE/ARCHIVED/CANCELLED)
    // booking.
    const bookingInfo = await getExistingBookingDetails(
      bookingId,
      organizationId
    );

    // Cross-user IDOR guard: `booking:create` is granted org-wide to
    // SELF_SERVICE/BASE, so without this a non-owner could add kits to another
    // user's booking. No-op for ADMIN/OWNER. Mirrors the asset flow's guard in
    // processBooking and the sibling adjust-asset-quantity route.
    validateBookingOwnership({
      booking: {
        creatorId: bookingInfo.creatorId,
        custodianUserId: bookingInfo.custodianUserId,
      },
      userId,
      role,
      action: "add kits to",
    });

    // AssetKit ids already represented on this booking. We dedupe by AssetKit
    // membership (NOT by asset id): a QUANTITY_TRACKED asset can sit on the
    // booking both standalone AND kit-driven at once, so a standalone row must
    // not block re-adding the kit-driven slice. `assetKitId` is non-null only
    // on kit-driven rows.
    const existingAssetKitIds = new Set(
      bookingInfo.bookingAssets
        .map((ba) => ba.assetKitId)
        .filter((id): id is string => id != null)
    );

    // Progressive-checkout guard: a kit checked out on another active booking
    // cannot be added to an ONGOING/OVERDUE booking. No-op for DRAFT/RESERVED;
    // excludes kits already on this booking. Shared with future callers and
    // covered by service-layer tests. See the helper's JSDoc for why the
    // manage-kits route keeps its own partial-checkin-aware variant.
    await assertKitsAddableToActiveBooking({
      kitIds,
      existingAssetKitIds,
      bookingStatus: bookingInfo.status,
      bookingId,
      organizationId,
    });

    // Resolve the kit memberships into kit-driven slice specs (org-scoped),
    // skipping any AssetKit already on the booking. Routing members through
    // `kitSlices` rather than the standalone `assetIds` bucket is what keeps the
    // kit recognizable in the booking overview (which groups by `assetKitId`).
    const kitSlices = await buildKitSlicesForBooking({
      kitIds,
      organizationId,
      existingAssetKitIds,
    });

    // Empty slices means every membership of the selected kit(s) is already on
    // the booking — nothing new to add. Surface the same friendly message as
    // before so the user picks a different booking.
    if (kitSlices.length === 0) {
      throw new ShelfError({
        cause: null,
        message: `The booking you have selected already contains the kit you are trying to add. Please select a different booking.`,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    const user = await getUserByID(authSession.userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });

    // Add the kit(s) as kit-driven rows only: `assetIds: []` prevents duplicate
    // standalone rows for the members and `kitSlices` carries the per-membership
    // rows. Added members stay AVAILABLE (progressive checkout) — no status flip
    // happens here regardless of booking status. `kitIds` is still forwarded for
    // note attribution / membership resolution.
    const booking = await updateBookingAssets({
      id: bookingId,
      organizationId,
      assetIds: [],
      kitSlices,
      kitIds,
      userId,
    });

    // Distinct member assets just added — used to attribute the per-asset
    // "added to booking" note below.
    const addedAssetIds = Array.from(
      new Set(kitSlices.map((slice) => slice.assetId))
    );

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
      assetIds: addedAssetIds,
      organizationId,
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
  function isValidBooking(
    booking: { status?: string | null } | null | undefined
  ) {
    // DRAFT/RESERVED (not yet started) + ONGOING/OVERDUE (active). Kits added to
    // an active booking stay AVAILABLE until purposefully checked out
    // (progressive checkout).
    return (
      !!booking?.status &&
      ["RESERVED", "DRAFT", "ONGOING", "OVERDUE"].includes(booking.status)
    );
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
            You can add a kit to Draft, Reserved, Ongoing or Overdue bookings.
            Kits added to an ongoing booking stay available until you check them
            out.
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
            <span className="font-medium text-gray-600">Draft</span>,{" "}
            <span className="font-medium text-gray-600">Reserved</span>,{" "}
            <span className="font-medium text-gray-600">Ongoing</span> and{" "}
            <span className="font-medium text-gray-600">Overdue</span> bookings
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
            type="submit"
            variant="primary"
            width="full"
            disabled={disabled}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Form>
  );
}
