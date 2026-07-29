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
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { db } from "~/database/db.server";

import { isQuantityTracked } from "~/modules/asset/utils";
import {
  loadBookingsData,
  processBooking,
  updateBookingAssets,
} from "~/modules/booking/service.server";
import { computeBookingAvailableQuantity } from "~/modules/consumption-log/service.server";
import { createNotes } from "~/modules/note/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
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
  assetIds: z.string().array().min(1, "At least one asset is required."),
  bookingId: z.string().min(1, "Please select a booking."),
  quantity: z.coerce.number().int().positive().optional(),
});

export const meta = () => [{ title: appendToMetaTitle("Add to booking") }];

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

    // loadBookingsData + the asset lookup are independent (both only
    // need organizationId from requirePermission above), so parallelise
    // for a faster TTFB.
    const [loaderData, asset] = await Promise.all([
      loadBookingsData({
        request,
        organizationId,
        userId: authSession?.userId,
        isSelfServiceOrBase,
        ids: assetId ? [assetId] : undefined,
      }),
      db.asset.findFirst({
        where: { id: assetId, organizationId },
        select: {
          id: true,
          title: true,
          type: true,
          quantity: true,
          unitOfMeasure: true,
        },
      }),
    ]);

    /**
     * For qty-tracked assets, compute current booking-aware availability so
     * the modal can cap the quantity input. The selected booking isn't known
     * yet at load time, so we don't exclude any booking here — this is the
     * conservative max the user can request. The action re-validates using
     * excludeBookingId once the target booking is known.
     */
    const assetAvailability =
      asset && isQuantityTracked(asset)
        ? await computeBookingAvailableQuantity(asset.id)
        : null;

    return data(payload({ ...loaderData, asset, assetAvailability }), {
      headers: [
        setCookie(await setSelectedOrganizationIdCookie(organizationId)),
      ],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

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
    const { assetIds, bookingId, quantity } = parseData(
      formData,
      updateBookingSchema,
      {
        additionalData: { userId },
        message: "Please select a Booking",
        shouldBeCaptured: false,
      }
    );

    const { finalAssetIds, bookingInfo } = await processBooking(
      bookingId,
      assetIds,
      organizationId,
      { userId, role }
    );

    /**
     * If a quantity was submitted (qty-tracked asset), validate it doesn't
     * exceed availability before writing to the booking. excludeBookingId
     * is the target booking so we don't double-count its own reservations.
     */
    let quantities: Record<string, number> | undefined;
    if (quantity != null && finalAssetIds.length === 1) {
      const assetId = finalAssetIds[0];
      const asset = await db.asset.findFirst({
        where: { id: assetId, organizationId },
        select: { id: true, title: true, type: true },
      });

      if (asset && isQuantityTracked(asset)) {
        const availability = await computeBookingAvailableQuantity(
          assetId,
          bookingId
        );
        if (quantity > availability.available) {
          /**
           * `availability.available` is SIGNED (raw headroom from the
           * canonical module via the wrapper). Clamp the printed count —
           * "only -7 available" reads as a bug — and name recovery paths
           * instead of a bare rejection.
           */
          const oversubscribedNote =
            availability.available < 0
              ? ` This asset's pool is already over-committed by ${-availability.available} unit(s) across other bookings — reduce or remove it from one of them, or cancel a booking, first.`
              : "";
          throw new ShelfError({
            cause: null,
            message: `Cannot reserve ${quantity} units of "${
              asset.title
            }". Only ${Math.max(
              0,
              availability.available
            )} available.${oversubscribedNote}`,
            label: "Booking",
            shouldBeCaptured: false,
            status: 400,
          });
        }
        quantities = { [assetId]: quantity };
      }
    }

    const bookingAssetIds = (
      "bookingAssets" in bookingInfo ? bookingInfo.bookingAssets : []
    ).map((ba) => ba.asset.id);

    if (
      bookingAssetIds.length > 0 &&
      intersected(bookingAssetIds, finalAssetIds)
    ) {
      throw new ShelfError({
        cause: null,
        message: `The booking you have selected already contains the asset you are trying to add. Please select a different booking.`,
        status: 400,
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

    const booking = await updateBookingAssets({
      id: bookingId,
      organizationId,
      assetIds: finalAssetIds,
      userId,
      quantities,
    });

    const actor = wrapUserLinkForNote({
      id: authSession.userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });
    const bookingLink = wrapLinkForNote(
      `/bookings/${booking.id}`,
      booking.name
    );
    await createNotes({
      content: `${actor} added asset to ${bookingLink}.`,
      type: "UPDATE",
      userId: authSession.userId,
      assetIds: finalAssetIds,
      organizationId,
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
    return data(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function ExistingBooking() {
  const { ids, asset, assetAvailability } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  const isQtyTracked = asset ? isQuantityTracked(asset) : false;
  const unitLabel = asset?.unitOfMeasure || "units";
  /**
   * `available` is the SIGNED raw headroom (the wrapper keeps it unclamped
   * so guards can branch on the sign). Clamp for display: an oversubscribed
   * pool must not render "Max available: -7" nor set `max={-7}` on the
   * input (min=1 > max makes every value invalid client-side). This is an
   * ADD flow, so blocking at 0 is correct — the over-committed note below
   * keeps the clamped 0 from silently hiding the oversubscription.
   */
  const rawAvailable = assetAvailability?.available;
  const maxQuantity =
    rawAvailable != null ? Math.max(0, rawAvailable) : undefined;
  const overCommittedBy =
    rawAvailable != null && rawAvailable < 0 ? -rawAvailable : 0;

  function isValidBooking(
    booking: { status?: string | null } | null | undefined
  ) {
    // DRAFT/RESERVED (not yet started) + ONGOING/OVERDUE (active). Adding to an
    // active booking keeps the asset AVAILABLE until it is purposefully checked
    // out (progressive checkout).
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
            You can add an asset to Draft, Reserved, Ongoing or Overdue
            bookings. Assets added to an ongoing booking stay available until
            you check them out.
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

        {isQtyTracked ? (
          <div className="mb-2">
            <Input
              name="quantity"
              type="number"
              label={`Quantity (${unitLabel})`}
              min={1}
              max={maxQuantity}
              step={1}
              defaultValue={1}
              required
            />
            {maxQuantity != null ? (
              <p className="mt-1 text-xs text-gray-500">
                Max available: {maxQuantity} {unitLabel}
              </p>
            ) : null}
            {/* Over-committed callout so the clamped 0 above never silently
                swallows an oversubscribed pool.

                why (copy): this surface receives only the signed `available`
                number — it cannot tell whether bookings, custody or
                check-outs consumed the pool. The old copy asserted "across
                other bookings", which is false whenever custody is the
                driver (5 total / 5 in custody / 5 reserved over-commits with
                bookings at exactly stock). State only what is known here and
                point at the overview card, which HAS the breakdown and names
                the real causes and cures. */}
            {overCommittedBy > 0 ? (
              <p className="mt-1 text-xs text-error-600">
                This asset's pool is already over-committed by {overCommittedBy}{" "}
                unit(s). Open the asset's overview to see what's holding the
                units and free some up first.
              </p>
            ) : null}
          </div>
        ) : null}

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
