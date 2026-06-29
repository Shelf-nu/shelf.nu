/**
 * Duplicate-booking confirmation modal.
 *
 * Confirms the user really wants to duplicate the booking, and — when the
 * source booking carries one or more KITS whose membership has drifted since
 * the source was created — surfaces that drift inline so the user
 * acknowledges the change before clicking Confirm.
 *
 * Kit drift comes from {@link computeBookingKitDrift} on the service layer.
 * The duplicate itself re-resolves kit members against each kit's current
 * `AssetKit` rows (see `duplicateBooking`), so this modal is the
 * acknowledgement surface for that re-resolution.
 *
 * @see {@link file://./../../modules/booking/service.server.ts} duplicateBooking, computeBookingKitDrift
 */

import { AssetType } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  Form,
  useActionData,
  useLoaderData,
} from "react-router";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import {
  computeBookingKitDrift,
  duplicateBooking,
  getBooking,
} from "~/modules/booking/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ bookingId: z.string() });

export const meta = () => [{ title: appendToMetaTitle("Duplicate booking") }];

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  const { bookingId } = getParams(params, paramsSchema);

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const [booking, kitDrift] = await Promise.all([
      getBooking({
        id: bookingId,
        organizationId,
        request,
        userOrganizations,
      }),
      // Drift is independent of the booking lookup — fetch in parallel so
      // the modal opens as quickly as today.
      computeBookingKitDrift({ bookingId, organizationId }),
    ]);

    return payload({
      showModal: true,
      booking,
      kitDrift,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw reason;
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  const { bookingId } = getParams(params, paramsSchema);

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const newBooking = await duplicateBooking({
      bookingId,
      organizationId,
      userId,
      request,
    });

    sendNotification({
      title: "Booking duplicated",
      senderId: userId,
      icon: { name: "success", variant: "success" },
      message: `Booking "${newBooking.name}" has been duplicated.`,
    });

    return redirect(`/bookings/${newBooking.id}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * Formats a per-asset label with an optional unit count for QT assets.
 *
 * - INDIVIDUAL assets render just the title.
 * - QUANTITY_TRACKED assets append `(× <qty>)` so the user can see how
 *   many units of that asset the kit currently carries.
 */
function formatDriftAssetLabel(item: {
  title: string;
  type: AssetType;
  quantity: number;
}) {
  if (item.type === AssetType.QUANTITY_TRACKED && item.quantity > 1) {
    return `${item.title} (× ${item.quantity})`;
  }
  return item.title;
}

export default function DuplicateBooking() {
  const { booking, kitDrift } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: { message: string } }>();

  const disabled = useDisabled();
  const hasDrift = kitDrift.length > 0;

  return (
    <div>
      <h3 className="mb-2">Duplicate Booking: {booking.name}</h3>

      <div className="mb-4 text-sm text-gray-500">
        <p className="mb-2">
          You're about to duplicate the booking{" "}
          <strong className="text-black">{booking.name}</strong>.
        </p>
        <p>
          All current booking details will be copied. You can review and edit
          them later.
        </p>
      </div>

      {hasDrift && (
        <div className="mb-4">
          {/* Yellow info banner — matches the bulk-partial-checkout dialog's
              info-box treatment so the modal feels consistent with other
              acknowledge-and-confirm surfaces. */}
          <p className="mb-3 rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-800">
            Kit changes since the original booking — these will be applied to
            the duplicate. The original booking is unchanged.
          </p>

          <div className="space-y-3">
            {kitDrift.map((kit) => (
              <div
                key={kit.kitId}
                className="rounded border border-gray-200 bg-white p-3"
              >
                <h4 className="mb-2 text-sm font-semibold text-gray-900">
                  {kit.kitName}
                </h4>

                {kit.added.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-gray-500">
                      Added since the original
                    </p>
                    <ul className="mt-1 space-y-1">
                      {kit.added.map((item) => (
                        <li
                          key={`added-${kit.kitId}-${item.assetId}`}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-block size-1.5 rounded-full bg-success-500"
                          />
                          <span className="text-gray-800">
                            {formatDriftAssetLabel(item)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {kit.removed.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Removed since the original
                    </p>
                    <ul className="mt-1 space-y-1">
                      {kit.removed.map((item) => (
                        <li
                          key={`removed-${kit.kitId}-${item.assetId}`}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-block size-1.5 rounded-full bg-error-500"
                          />
                          <span className="text-gray-500 line-through">
                            {formatDriftAssetLabel(item)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {actionData?.error && (
        <div className="mb-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-500">{actionData.error.message}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={disabled}
          to=".."
        >
          Cancel
        </Button>

        <Form method="POST" className="flex-1">
          <Button type="submit" className="w-full" disabled={disabled}>
            Confirm
          </Button>
        </Form>
      </div>
    </div>
  );
}
