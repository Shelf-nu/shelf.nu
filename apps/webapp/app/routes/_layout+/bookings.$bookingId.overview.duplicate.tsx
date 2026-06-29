/**
 * Booking "duplicate" dialog route.
 *
 * Renders a modal that copies an existing booking into a fresh DRAFT. The dialog
 * exposes editable Start/End date+time inputs so the user can pick when the
 * duplicated booking runs — prefilled with the next valid working slot (the same
 * default as the new-booking form) rather than the source booking's dates, which
 * are usually in the past and would fail validation. It also surfaces KIT DRIFT
 * inline when a source kit's membership has drifted since the booking was
 * created, so the user acknowledges the change before clicking Confirm.
 *
 * Dates are validated server-side with {@link DuplicateBookingSchema}, which
 * reuses the exact same rules (buffer/future, working-hours, end-after-start,
 * max-length) as the new-booking form. Kit drift comes from
 * {@link computeBookingKitDrift}; the duplicate re-resolves kit members against
 * each kit's current `AssetKit` rows (see `duplicateBooking`).
 *
 * @see {@link file://./bookings.new.tsx} for the mirrored loader/action/form patterns.
 * @see {@link file://./../../modules/booking/service.server.ts} duplicateBooking, computeBookingKitDrift
 */
import { useRef, useState } from "react";
import { AssetType } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  Form,
  useActionData,
  useLoaderData,
} from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { DatesFields } from "~/components/booking/forms/fields/dates";
import {
  DuplicateBookingSchema,
  type DuplicateBookingSchemaType,
} from "~/components/booking/forms/forms-schema";
import { Button } from "~/components/shared/button";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useDisabled } from "~/hooks/use-disabled";
import { useWorkingHours } from "~/hooks/use-working-hours";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  computeBookingKitDrift,
  duplicateBooking,
  getBooking,
} from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { getBookingDefaultStartEndTimes } from "~/modules/working-hours/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getHints, useHints } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { getValidationErrors } from "~/utils/http";
import {
  payload,
  error,
  getParams,
  parseData,
  type DataOrErrorResponse,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ bookingId: z.string() });

export const meta = () => [{ title: appendToMetaTitle("Duplicate booking") }];

/**
 * Loads the source booking (for the modal heading and the duplicate copy) plus
 * any per-kit membership drift to surface in the confirmation modal.
 *
 * @returns The source booking, its kit drift, and a `showModal` flag.
 * @throws {ShelfError} If the user lacks booking-create permission or the
 *   booking cannot be resolved within the caller's organization.
 */
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

/**
 * Validates the user-supplied start/end dates and duplicates the booking.
 *
 * Dates are validated with {@link DuplicateBookingSchema} (same rules as the
 * new-booking form). On validation failure a 400 is returned so the dialog can
 * surface field-level errors via `getValidationErrors`. On success the new
 * DRAFT booking is created with the chosen window and the user is redirected to
 * its overview.
 *
 * @returns A redirect to the new booking on success, or a `DataOrErrorResponse`
 *   carrying validation/field errors on failure.
 * @throws {ShelfError} If the user lacks booking-create permission.
 */
export async function action({ request, context, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  const { bookingId } = getParams(params, paramsSchema);

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const formData = await request.formData();
    const hints = getHints(request);
    const workingHours = await getWorkingHoursForOrganization(organizationId);
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);

    // ADMIN/OWNER users bypass time restrictions (bufferStartTime, maxBookingLength)
    const isAdminOrOwner = !isSelfServiceOrBase;

    // `coerceLocalDate` (inside the schema) parses the `datetime-local` wire
    // strings into absolute instants in the user's timezone via `fromISO`,
    // which tolerates second-precision input. Use the validated/coerced result
    // directly rather than re-parsing the raw form data with a stricter
    // minute-only format (which would yield an Invalid Date if seconds slipped
    // through).
    const { startDate: from, endDate: to } = parseData(
      formData,
      DuplicateBookingSchema({
        hints,
        workingHours,
        bookingSettings,
        isAdminOrOwner,
      }),
      {
        // Expected user-input validation (e.g. "Start date must be at least N
        // hours from now") — a 400, not a server error. Don't capture to Sentry.
        shouldBeCaptured: false,
        additionalData: { userId, organizationId, bookingId },
      }
    );

    const newBooking = await duplicateBooking({
      bookingId,
      organizationId,
      userId,
      request,
      from,
      to,
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

/**
 * Duplicate-booking dialog.
 *
 * Exposes editable Start/End date+time inputs (prefilled with the next valid
 * working slot via {@link getBookingDefaultStartEndTimes}) validated client-side
 * with Zorm and server-side via {@link DuplicateBookingSchema}, and surfaces kit
 * drift inline (from {@link computeBookingKitDrift}) so the user acknowledges any
 * kit-membership changes before confirming.
 */
export default function DuplicateBooking() {
  const { booking, kitDrift } = useLoaderData<typeof loader>();
  const actionData = useActionData<DataOrErrorResponse>();

  const disabled = useDisabled();
  const hints = useHints();

  // Working hours + booking settings drive the date defaults and validation,
  // mirroring the new-booking form so both surfaces behave identically.
  const workingHoursData = useWorkingHours();
  const { workingHours } = workingHoursData;
  const bookingSettings = useBookingSettings();

  const { isAdministratorOrOwner } = useUserRoleHelper();

  // Prefill with the next valid working slot — NOT the source booking's dates,
  // which are usually in the past and would fail validation.
  const { startDate: defaultStartDate, endDate: defaultEndDate } =
    getBookingDefaultStartEndTimes(
      workingHours,
      bookingSettings.bufferStartTime,
      isAdministratorOrOwner
    );

  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);

  // Re-sync endDate when the computed default changes (e.g. when working hours or
  // buffer settings load). Uses the React "store previous value in a ref" pattern
  // so we mirror the prop during render instead of via a useEffect.
  const prevDefaultEndDate = useRef(defaultEndDate);
  if (defaultEndDate && defaultEndDate !== prevDefaultEndDate.current) {
    prevDefaultEndDate.current = defaultEndDate;
    setEndDate(defaultEndDate);
  }

  const zo = useZorm(
    "DuplicateBooking",
    DuplicateBookingSchema({
      hints,
      workingHours,
      bookingSettings,
      isAdminOrOwner: isAdministratorOrOwner,
    })
  );

  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<DuplicateBookingSchemaType>(
    actionData?.error
  );

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
          All current booking details will be copied. Choose the start and end
          dates for the new booking below — you can review and edit everything
          else later.
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

      <Form ref={zo.ref} method="POST">
        <div className="mb-4">
          <DatesFields
            startDate={startDate}
            startDateName={zo.fields.startDate()}
            startDateError={
              validationErrors?.startDate?.message ||
              zo.errors.startDate()?.message
            }
            setStartDate={setStartDate}
            endDate={endDate}
            endDateName={zo.fields.endDate()}
            endDateError={
              validationErrors?.endDate?.message || zo.errors.endDate()?.message
            }
            setEndDate={setEndDate}
            disabled={disabled}
            isNewBooking={true}
            workingHoursData={workingHoursData}
          />
        </div>

        {actionData?.error && (
          // role="alert" so non-field server errors are announced to screen
          // readers when the dialog re-renders after a failed submit.
          <div role="alert" className="mb-4 rounded-md bg-red-50 p-4">
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

          <Button type="submit" className="flex-1" disabled={disabled}>
            Confirm
          </Button>
        </div>
      </Form>
    </div>
  );
}
