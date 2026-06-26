/**
 * Booking "duplicate" dialog route.
 *
 * Renders a modal that copies an existing booking into a fresh DRAFT. Unlike a
 * one-click confirm, the dialog now exposes editable Start/End date+time inputs
 * so the user can pick when the duplicated booking runs. The inputs are
 * prefilled with the next valid working slot (the SAME default as the
 * new-booking form) rather than the source booking's dates, which are usually
 * in the past and would fail validation.
 *
 * The dates are validated server-side with {@link DuplicateBookingSchema}, which
 * reuses the exact same rules (buffer/future, working-hours, end-after-start,
 * max-length) as the new-booking form — see
 * `~/components/booking/forms/forms-schema.ts`.
 *
 * @see {@link file://./bookings.new.tsx} for the mirrored loader/action/form patterns.
 */
import { useRef, useState } from "react";
import { DateTime } from "luxon";
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
import { duplicateBooking, getBooking } from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { getBookingDefaultStartEndTimes } from "~/modules/working-hours/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getHints, useHints } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
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
 * Loads the source booking so the dialog can show its name and copy its details.
 *
 * @returns The source booking and a `showModal` flag for the modal layout.
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

    const booking = await getBooking({
      id: bookingId,
      organizationId,
      request,
      userOrganizations,
    });

    return payload({
      showModal: true,
      booking,
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

    parseData(
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

    const from = DateTime.fromFormat(
      formData.get("startDate")!.toString(),
      DATE_TIME_FORMAT,
      {
        zone: hints.timeZone,
      }
    ).toJSDate();

    const to = DateTime.fromFormat(
      formData.get("endDate")!.toString(),
      DATE_TIME_FORMAT,
      {
        zone: hints.timeZone,
      }
    ).toJSDate();

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
 * Duplicate-booking dialog.
 *
 * Prefills the editable Start/End date+time inputs with the next valid working
 * slot (via {@link getBookingDefaultStartEndTimes}) and validates them
 * client-side with Zorm, falling back to server-side validation errors so the
 * user always sees a meaningful message even if client validation is bypassed.
 */
export default function DuplicateBooking() {
  const { booking } = useLoaderData<typeof loader>();
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

          <Button type="submit" className="flex-1" disabled={disabled}>
            Confirm
          </Button>
        </div>
      </Form>
    </div>
  );
}
