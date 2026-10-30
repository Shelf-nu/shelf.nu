/**
 * The Change end date dialog of a running booking.
 *
 * Before the person picks anything it states the horizon: how long nothing
 * else has the items still out reserved by name, and which reservation
 * needs what after that, with a one-click end just before it. A submit past
 * the horizon comes back as a refusal that names each reservation in the way
 * and the items it holds.
 *
 * The fetcher is keyed per booking and every outcome is read through
 * `useFetcherOutcomeSinceOpen`, so a response answers the opening that sent
 * it and never an earlier or later one.
 *
 * @see {@link file://../../modules/booking/next-reservations.server.ts} the horizon
 * @see {@link file://../../modules/booking/extend-horizon.ts} the suggested end
 * @see {@link file://../../routes/_layout+/bookings.$bookingId.overview.tsx} the action
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { useFetcher, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import { useDisabled } from "~/hooks/use-disabled";
import { useFetcherOutcomeSinceOpen } from "~/hooks/use-fetcher-error-since-open";
import { useFormatPrefs } from "~/hooks/use-format-prefs";
import { useRoleAccess } from "~/hooks/use-role-access";
import { useWorkingHours } from "~/hooks/use-working-hours";
import type { ClashingBooking } from "~/modules/booking/clashing-bookings";
import {
  readClashRefusal,
  suggestEndBeforeClash,
} from "~/modules/booking/extend-horizon";
import type { ExtendHorizon } from "~/modules/booking/next-reservations.server";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";
import { wallClockWireInZone } from "~/utils/date-format";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { DateTimePicker } from "../shared/date-time-picker";
import When from "../when/when";
import { WorkingHoursInfo } from "./forms/fields/dates";
import {
  ExtendBookingSchema,
  type ExtendBookingSchemaType,
} from "./forms/forms-schema";

type ExtendBookingDialogProps = {
  className?: string;
  /** The current end as the picker's naive wire string, in the pref zone. */
  currentEndDate: string;
};

/** Items named per booking before "+N more"; keeps the dialog short. */
const MAX_ITEMS_NAMED = 3;
/** Bookings listed in a refusal before "+N more bookings". */
const MAX_BOOKINGS_LISTED = 5;

export default function ExtendBookingDialog({
  className,
  currentEndDate,
}: ExtendBookingDialogProps) {
  const [open, setOpen] = useState(false);
  // The picker is uncontrolled; a suggested end re-seeds it through its key.
  const [seededEndDate, setSeededEndDate] = useState<string | null>(null);
  // The refusal the person answered by taking the suggested end; it is not
  // shown again while that same response is still the fetcher's.
  const [answeredRefusal, setAnsweredRefusal] = useState<unknown>(undefined);
  const { booking, nextReservations } = useLoaderData<BookingPageLoaderData>();
  const fetcher = useFetcher<DataOrErrorResponse>({
    key: `extend-booking-${booking.id}`,
  });
  const outcome = useFetcherOutcomeSinceOpen(fetcher, open);
  const disabled = useDisabled(fetcher);
  // Validate the new end date in the user's RESOLVED pref zone: the server
  // action parses the submitted value in that same zone, and the browser hint
  // differs from it for anyone with an explicit timezone preference.
  const prefs = useFormatPrefs();
  const workingHoursData = useWorkingHours();
  const bookingSettings = useBookingSettings();
  const { isLoading = true, error } = workingHoursData;
  const workingHoursDisabled = disabled || isLoading;
  const roleAccess = useRoleAccess();

  const zo = useZorm(
    "ExtendBooking",
    ExtendBookingSchema({
      prefs,
      workingHours: workingHoursData.workingHours,
      bookingSettings,
      bypassTimeLimits: roleAccess.policy.bookings.bypassTimeLimits,
    })
  );

  function handleOpen() {
    setSeededEndDate(null);
    setAnsweredRefusal(undefined);
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
  }

  useEffect(
    function closeOnSuccess() {
      if (outcome.status === "accepted") setOpen(false);
    },
    [outcome.status]
  );

  const horizon = nextReservations?.horizon ?? null;
  const suggestedEnd = useMemo(() => {
    if (!horizon) return null;
    return suggestEndBeforeClash({
      currentEnd: new Date(booking.to),
      clashStart: new Date(horizon.freeUntil),
      timeZone: prefs.timeZone,
    });
  }, [horizon, booking.to, prefs.timeZone]);

  // A refusal of this opening, unless the person already answered it.
  const rejected =
    outcome.status === "rejected" && fetcher.data !== answeredRefusal
      ? fetcher.data
      : undefined;
  const rejectedError =
    rejected && "error" in rejected ? rejected.error : undefined;
  /** This handles server side errors in case client side validation fails */
  const validationErrors =
    getValidationErrors<ExtendBookingSchemaType>(rejectedError);
  const refusal = readClashRefusal(rejectedError?.additionalData);
  const pickerValue = seededEndDate ?? currentEndDate;

  return (
    <>
      <Button
        type="button"
        variant="link"
        className="justify-start rounded px-2 py-1.5 text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
        width="full"
        onClick={handleOpen}
      >
        Change end date
      </Button>

      <DialogPortal>
        <Dialog
          className={tw("lg:max-w-[450px]", className)}
          open={open}
          onClose={handleClose}
          title={
            <div className="flex size-10 items-center justify-center rounded-full bg-primary-25">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary-50">
                <CalendarIcon className="size-4 text-primary-500" />
              </div>
            </div>
          }
        >
          <div className="px-6 pb-4">
            <h3 className="mb-1">Change end date</h3>
            <p className="mb-4">
              Pick a new end date for this booking. Items stay checked out until
              they are checked in; if they come back after the new end, the
              booking becomes overdue.
            </p>

            {horizon ? (
              <HorizonNotice
                horizon={horizon}
                suggestedEnd={suggestedEnd}
                disabled={disabled}
                onUseSuggested={(wire) => {
                  setAnsweredRefusal(fetcher.data);
                  setSeededEndDate(wire);
                }}
                timeZone={prefs.timeZone}
              />
            ) : null}

            <fetcher.Form ref={zo.ref} method="POST">
              <div className="required-input-label mb-1 text-text-sm font-medium text-gray-700">
                New end date
              </div>

              <DateTimePicker
                key={pickerValue}
                mode="datetime"
                defaultValue={pickerValue}
                label="End Date"
                hideLabel
                name={zo.fields.endDate()}
                disabled={disabled || workingHoursDisabled}
                error={
                  validationErrors?.endDate?.message ||
                  zo.errors.endDate()?.message
                }
                className="mb-4 w-full"
                placeholder="Booking"
              />

              <When truthy={!!rejectedError}>
                <div className="mb-4 text-sm text-error-500">
                  {rejectedError?.message}
                </div>
                {refusal ? (
                  <ClashList
                    bookings={refusal.clashingBookings}
                    freeUntil={horizon ? null : refusal.freeUntil}
                  />
                ) : null}
              </When>

              <WorkingHoursInfo
                workingHoursData={workingHoursData}
                loading={isLoading}
                className="mb-4"
              />
              {error && (
                <p className="mt-1 text-sm text-orange-600">
                  Working hours validation unavailable: {error}
                </p>
              )}
              <input type="hidden" name="intent" value="extend-booking" />
              <input
                type="hidden"
                name={zo.fields.startDate()}
                value={booking.from.toISOString()}
              />

              <div className="flex items-center gap-2">
                <Button
                  disabled={disabled}
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={disabled}>
                  Submit
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}

/**
 * How long nothing else has these items reserved by name, what the first
 * reservation needs, and the one-click end just before it.
 *
 * Reservations by model ("any unit of model X") name no item, so they are
 * outside this horizon; a submit still measures them.
 */
function HorizonNotice({
  horizon,
  suggestedEnd,
  disabled,
  onUseSuggested,
  timeZone,
}: {
  horizon: ExtendHorizon;
  suggestedEnd: Date | null;
  disabled: boolean;
  onUseSuggested: (wire: string) => void;
  timeZone: string;
}) {
  const { formatDateTime } = useDateFormatter();
  const { blockedBy } = horizon;
  return (
    <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
      <span className="font-medium text-gray-900">
        No other booking has these items reserved until{" "}
        {formatDateTime(horizon.freeUntil)}.
      </span>{" "}
      After that,{" "}
      {blockedBy.id ? (
        <Button
          to={`/bookings/${blockedBy.id}`}
          target="_blank"
          variant="inherit"
          className="font-medium underline"
        >
          {blockedBy.name}
        </Button>
      ) : (
        blockedBy.name
      )}{" "}
      needs {namedItems(blockedBy)}.
      <div className="mt-1 text-xs text-gray-500">
        Reservations by model are checked when you submit.
      </div>
      {suggestedEnd ? (
        <div className="mt-2">
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={disabled}
            onClick={() =>
              onUseSuggested(wallClockWireInZone(suggestedEnd, timeZone))
            }
          >
            Use {formatDateTime(suggestedEnd)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The reservations in the way of the end just asked for. */
function ClashList({
  bookings,
  freeUntil,
}: {
  bookings: ClashingBooking[];
  freeUntil: string | null;
}) {
  const { formatDate, formatDateTime } = useDateFormatter();
  const listed = bookings.slice(0, MAX_BOOKINGS_LISTED);
  const rest = bookings.length - listed.length;
  return (
    <div className="mb-4">
      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 text-sm">
        {listed.map((b, index) => (
          <li
            key={b.id ?? `hidden-${index}`}
            className="flex items-start justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              {b.id ? (
                <Button
                  variant="link"
                  className="font-medium"
                  target="_blank"
                  to={`/bookings/${b.id}`}
                >
                  {b.name}
                </Button>
              ) : (
                <span className="font-medium text-gray-900">{b.name}</span>
              )}
              {b.items.length > 0 ? (
                <div className="text-gray-600">{namedItems(b)}</div>
              ) : null}
            </div>
            {b.from ? (
              <span className="shrink-0 text-gray-500">
                from {formatDate(b.from)}
              </span>
            ) : null}
          </li>
        ))}
        {rest > 0 ? (
          <li className="px-3 py-2 text-gray-500">
            +{rest} more {rest === 1 ? "booking" : "bookings"}
          </li>
        ) : null}
      </ul>
      {freeUntil ? (
        <p className="mt-2 text-sm text-gray-600">
          Free until {formatDateTime(freeUntil)}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The first few shared items by name, then "+N more".
 *
 * @param booking - A clashing booking with its shared items
 * @returns "Cam 1, Cam 2, Kit A (kit) +4 more"
 */
function namedItems(booking: ClashingBooking): string {
  const names = booking.items.map((item) =>
    item.kind === "kit" ? `${item.name} (kit)` : item.name
  );
  const shown = names.slice(0, MAX_ITEMS_NAMED);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}
