import { useRef, useState, type MouseEvent } from "react";
import type { Booking, BookingStatus } from "@prisma/client";
import { Zap } from "lucide-react";
import { DateTime } from "luxon";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import { useDisabled } from "~/hooks/use-disabled";
import type { CheckoutSourceQuestion } from "~/modules/booking/checkout-source-location";
import {
  isBookingEarlyCheckout,
  isReservationExpired,
} from "~/modules/booking/helpers";
import type { UnassignedModelUnits } from "~/utils/booking-model-requests";
import { summarizeUnassignedUnits } from "~/utils/booking-model-requests";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { tw } from "~/utils/tw";
import { CheckoutSourceSelect } from "./checkout-source-select";
import type { ButtonProps } from "../shared/button";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";

export enum CheckoutIntentEnum {
  /** Early check-out: move the start to now. */
  "with-adjusted-date" = "with-adjusted-date",
  /** Keep the stored dates (an expired reservation then lands OVERDUE). */
  "without-adjusted-date" = "without-adjusted-date",
  /**
   * Expired reservation: a new window from now to the posted
   * `expiredCheckoutNewTo`. Only the full check-out accepts it.
   */
  "with-new-end-date" = "with-new-end-date",
}

/**
 * The booking a check-out dialog is about. `status` and `to` are what the
 * expired-reservation prompt reads (see `isReservationExpired`): a caller that
 * leaves them out never shows it, and the service then refuses the check-out
 * with its own message rather than landing the booking in OVERDUE silently.
 */
export type CheckoutDialogBooking = Pick<Booking, "id" | "name" | "from"> & {
  status?: BookingStatus;
  /** May arrive as an ISO string off serialized loader data. */
  to?: Date | string | null;
};

/** The field the expired-reservation prompt posts its picked end date in. */
export const EXPIRED_CHECKOUT_NEW_TO_FIELD = "expiredCheckoutNewTo";

/**
 * The end date the expired-reservation prompt proposes: now plus the planned
 * length, as a naive `yyyy-MM-dd'T'HH:mm` string in the user's resolved
 * timezone, the zone every booking date input is written and read in.
 *
 * @param booking - The expired reservation
 * @param timeZone - The user's resolved timezone preference
 * @returns The input's default value
 */
export function proposedExpiredCheckoutEndDate(
  booking: Pick<CheckoutDialogBooking, "from" | "to">,
  timeZone: string
): string {
  const from = booking.from ? new Date(booking.from) : null;
  const to = booking.to ? new Date(booking.to) : null;
  const plannedLengthMs =
    from && to ? Math.max(to.getTime() - from.getTime(), 0) : 0;
  const now = DateTime.now().setZone(timeZone).startOf("minute");
  // A reservation with no measurable length (bad data) still gets a usable
  // proposal: an hour from now, so the operator is not handed "now" to fix.
  const proposed =
    plannedLengthMs > 0
      ? now.plus({ milliseconds: plannedLengthMs })
      : now.plus({ hours: 1 });
  return proposed.toFormat(DATE_TIME_FORMAT);
}

type CheckoutDialogProps = {
  disabled?: ButtonProps["disabled"];
  booking: CheckoutDialogBooking;
  /** A container to render the AlertContent inside */
  portalContainer?: HTMLElement;
  /** Form ID for explicit form association when buttons render in a portal */
  formId?: string;
  /**
   * Optional className override for the trigger button. Defaults to the
   * variant-aware composition below (`"grow"` for the default variant,
   * full-width link styling for `"dropdown"`). Embedded contexts (e.g. the
   * fulfil-and-checkout drawer) can pass a narrower class so the button
   * doesn't stretch oddly when its sibling buttons aren't also `grow`.
   */
  triggerClassName?: string;
  /**
   * The form `intent` submitted with the checkout. Defaults to the full-booking
   * `"checkOut"` flow. The bulk partial-checkout dialog passes
   * `"partial-checkout"` so that an early checkout of the SELECTED assets routes
   * through `checkoutAssets` / `partialCheckoutBooking` (which records the batch
   * and applies the adjusted-date choice) instead of the whole-booking
   * `checkoutBooking`. The scanner checkout-assets route ignores intent (always
   * partial), so it can leave the default.
   */
  intent?: string;
  /** Custom label for the trigger button */
  label?: string;
  /**
   * Rendering context. `"dropdown"` styles the trigger as a left-aligned link
   * row so it sits inside a `DropdownMenuItem` like the check-in flow.
   */
  variant?: "default" | "dropdown";
  /**
   * Skip the early-checkout "adjust start date" prompt and submit directly.
   * Pass `true` when the booking has already started (ONGOING/OVERDUE) — e.g.
   * "Check out remaining" — because adjusting the start date only makes sense
   * for the first checkout that transitions RESERVED → ONGOING.
   * `partialCheckoutBooking` ignores the date choice unless the booking is
   * RESERVED, so prompting here would be a confusing no-op.
   */
  suppressEarlyCheckoutPrompt?: boolean;
  /** Render the trigger button full-width to match a sibling full-width button. */
  fullWidth?: boolean;
  /**
   * Reserved model units no asset has been assigned to yet. When any are
   * listed, the trigger opens a confirmation naming them before the check-out
   * submits: they stay open on the booking, and the operator should know that
   * before the booking goes out without them.
   */
  unassignedUnits?: UnassignedModelUnits[];
  /**
   * Pools on the booking that sit at two or more locations and are about to
   * go out for the first time. When any are listed, the trigger opens a
   * confirmation with one "From location" select per pool; otherwise the
   * check-out needs no extra question.
   */
  sourceQuestions?: CheckoutSourceQuestion[];
  /**
   * Whether the expired-reservation prompt may offer a new end date. Only the
   * full check-out from the booking header can commit a new window for the
   * whole booking; a scan or a selected batch offers "as overdue" and points
   * at that button.
   */
  allowNewEndDate?: boolean;
  /**
   * Whether a plain check-out (not early, nothing unassigned, no source
   * question) asks once before it submits. Defaults to `true`, so a quick
   * check-out from the booking header opens a "Check out booking" dialog.
   * Pass `false` from a drawer or dialog that is itself the confirmation
   * step, so the operator is not asked twice; the trigger then submits
   * directly. Early check-outs, unassigned units and source questions open
   * the dialog either way.
   */
  confirm?: boolean;
};

/**
 * Stable empty lists for the defaults below: a fresh `[]` per render would be
 * a new prop value every time for a caller that passes nothing.
 */
const NO_UNASSIGNED_UNITS: UnassignedModelUnits[] = [];
const NO_SOURCE_QUESTIONS: CheckoutSourceQuestion[] = [];

/**
 * The confirm dialog's title: the most pressing reason it opened.
 *
 * @returns One short line
 */
function checkoutDialogTitle({
  hasUnassigned,
  isEarlyCheckout,
  isExpiredCheckout,
  asksSource,
}: {
  hasUnassigned: boolean;
  isEarlyCheckout: boolean;
  isExpiredCheckout: boolean;
  asksSource: boolean;
}): string {
  if (hasUnassigned) return "Some reserved units aren't assigned";
  if (isEarlyCheckout) return "Early Check-Out Warning";
  if (isExpiredCheckout) return "Reservation dates have passed";
  if (asksSource) return "Where do the units come from?";
  return "Check out booking";
}

/**
 * What a plain check-out does, for the confirmation's body. Only the
 * whole-booking `checkOut` starts the booking and takes every asset; any other
 * intent gets wording that claims neither.
 *
 * @param intent - The form `intent` the confirm button submits
 * @returns The sentence before and after the booking name
 */
function plainCheckoutSentence(intent: string): {
  lead: string;
  tail: string;
} {
  if (intent === "checkOut") {
    return {
      lead: "This checks out every asset of",
      tail: " and starts the booking.",
    };
  }
  if (intent === "checkOutRemaining") {
    return { lead: "This checks out the remaining assets of", tail: "." };
  }
  return { lead: "This checks out the selected assets of", tail: "." };
}

export default function CheckoutDialog({
  disabled,
  booking,
  portalContainer,
  formId,
  triggerClassName,
  intent = "checkOut",
  label = "Check Out",
  variant = "default",
  suppressEarlyCheckoutPrompt = false,
  fullWidth = false,
  unassignedUnits = NO_UNASSIGNED_UNITS,
  sourceQuestions = NO_SOURCE_QUESTIONS,
  allowNewEndDate = false,
  confirm = true,
}: CheckoutDialogProps) {
  const isNavigating = useDisabled();
  const { prefs } = useDateFormatter();
  const isDisabled = disabled || isNavigating;
  const isEarlyCheckout =
    !suppressEarlyCheckoutPrompt && isBookingEarlyCheckout(booking.from);
  /**
   * The reservation's whole window has passed. Exclusive with the early
   * prompt (early needs a future start, expired a past end), and never true
   * once the booking is underway, where `status` is no longer RESERVED. The
   * server refuses an expired check-out that made no choice, so this prompt
   * is the only way the operator can answer it.
   */
  const isExpiredCheckout = isReservationExpired(booking.status, booking.to);
  const unassignedSummary = summarizeUnassignedUnits(unassignedUnits);
  const unassignedUnitCount = unassignedUnits.reduce(
    (sum, unit) => sum + Math.max(0, unit.count),
    0
  );

  /** Shared trigger styling so the dropdown row matches the check-in dropdown */
  const isDropdown = variant === "dropdown";
  /**
   * Default trigger styling computed from `variant`. Callers can override the
   * entire class via the `triggerClassName` prop (e.g. the fulfil-and-checkout
   * drawer narrows the button so it doesn't stretch oddly next to siblings).
   */
  const computedTriggerClassName = tw(
    "whitespace-nowrap",
    isDropdown
      ? "w-full justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
      : "grow"
  );
  const resolvedTriggerClassName = triggerClassName ?? computedTriggerClassName;
  /** Dropdown rows pair the label with an icon; the default trigger is text-only */
  const triggerContent = isDropdown ? (
    <span className="flex items-center gap-2">
      <Zap className="size-4" /> {label}
    </span>
  ) : (
    label
  );

  const asksSource = sourceQuestions.length > 0;
  /** No early, expired, unassigned or source reason applies: only the plain confirmation. */
  const isPlainCheckout =
    !isEarlyCheckout && !isExpiredCheckout && !unassignedSummary && !asksSource;
  const plainSentence = plainCheckoutSentence(intent);
  /**
   * The dialog is controlled so a submit closes it: a refused check-out then
   * shows its error on the page instead of behind the still-open dialog.
   *
   * Close on the next task, never synchronously in `onClick`. The submitter,
   * the hidden `intent` and the source selects all live in this dialog, and
   * React commits a click's state update before the browser runs the
   * button's submission. Unmounting them first drops them from the form, so
   * the check-out sends nothing or sends it without its fields.
   *
   * When the form fails constraint validation (a cleared booking name, an
   * out-of-range quantity) the browser does not submit. The modal would hide
   * its message, so the dialog still closes and the form reports the field
   * that blocked the check-out from `onCloseAutoFocus`: by then the dialog
   * is gone, and cancelling Radix's focus restore keeps focus on that field
   * rather than pulling it back to the trigger.
   */
  const [open, setOpen] = useState(false);
  /** The form a blocked submit belongs to, reported once the dialog closes. */
  const blockedFormRef = useRef<HTMLFormElement | null>(null);
  const closeOnSubmit = (event: MouseEvent<HTMLButtonElement>) => {
    /** `button.form` resolves `form={formId}` even from inside the portal. */
    const form = event.currentTarget.form;
    blockedFormRef.current = form && !form.checkValidity() ? form : null;
    setTimeout(() => setOpen(false), 0);
  };
  const reportBlockedForm = (event: Event) => {
    const form = blockedFormRef.current;
    if (!form) return;
    blockedFormRef.current = null;
    event.preventDefault();
    form.reportValidity();
  };

  if (isPlainCheckout && !confirm) {
    return (
      <Button
        disabled={isDisabled}
        className={resolvedTriggerClassName}
        size={isDropdown ? undefined : "sm"}
        type="submit"
        name="intent"
        value={intent}
        form={formId}
        variant={isDropdown ? "link" : "primary"}
        width={isDropdown || fullWidth ? "full" : undefined}
      >
        {triggerContent}
      </Button>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          disabled={isDisabled}
          className={resolvedTriggerClassName}
          size={isDropdown ? undefined : "sm"}
          type="button"
          variant={isDropdown ? "link" : "primary"}
          width={isDropdown || fullWidth ? "full" : undefined}
        >
          {triggerContent}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent
        portalProps={{ container: portalContainer }}
        onCloseAutoFocus={reportBlockedForm}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {checkoutDialogTitle({
              hasUnassigned: Boolean(unassignedSummary),
              isEarlyCheckout,
              isExpiredCheckout,
              asksSource,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3">
              {isPlainCheckout ? (
                <p>
                  {plainSentence.lead}{" "}
                  <span className="font-bold text-gray-700">
                    {booking.name}
                  </span>
                  {plainSentence.tail}
                </p>
              ) : null}
              {unassignedSummary ? (
                <p>
                  <span className="font-bold text-gray-700">
                    {unassignedSummary}
                  </span>{" "}
                  {unassignedUnitCount === 1
                    ? "is not assigned yet. It stays on the booking so you can scan it later or release it."
                    : "are not assigned yet. They stay on the booking so you can scan them later or release them."}
                </p>
              ) : null}
              {isEarlyCheckout ? (
                <p>
                  You are checking out the booking more than 15 minutes before
                  the start date. If you proceed, the start date will be
                  adjusted to now:{" "}
                  <span className="font-bold text-gray-700">
                    <DateS date={new Date()} includeTime />
                  </span>
                  . Do you want to adjust the start date or keep the original
                  date?
                </p>
              ) : null}
              {asksSource ? (
                <p>
                  {sourceQuestions.length === 1
                    ? "This item is kept at more than one location."
                    : "These items are kept at more than one location."}{" "}
                  Pick where the units leave from. Units used up on this booking
                  come off that location at check-in.
                </p>
              ) : null}
              {isExpiredCheckout ? (
                <p>
                  This booking's reserved period ended on{" "}
                  <span className="font-bold text-gray-700">
                    <DateS date={booking.to!} includeTime />
                  </span>
                  .{" "}
                  {allowNewEndDate
                    ? "Check it out with a new end date, starting now, or check it out as overdue."
                    : "Check these items out as overdue, or use Check out on the booking page to give the whole booking a new end date."}
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isExpiredCheckout && allowNewEndDate ? (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${EXPIRED_CHECKOUT_NEW_TO_FIELD}-${booking.id}`}
              className="text-sm font-medium text-gray-700"
            >
              New end date
            </label>
            {/* Proposed: now plus the planned length, in the user's timezone.
                Posted with the form; the server reads it only for "with a new
                end date" and validates it like an extension. No native
                `required` or `min`: both buttons submit the booking form, and
                a constraint here would block "as overdue", which never reads
                the field. */}
            <input
              id={`${EXPIRED_CHECKOUT_NEW_TO_FIELD}-${booking.id}`}
              type="datetime-local"
              name={EXPIRED_CHECKOUT_NEW_TO_FIELD}
              form={formId}
              defaultValue={proposedExpiredCheckoutEndDate(
                booking,
                prefs.timeZone
              )}
              disabled={Boolean(isDisabled)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-primary-300 focus:outline-none"
            />
          </div>
        ) : null}

        {asksSource ? (
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
            {sourceQuestions.map((question) => (
              <CheckoutSourceSelect
                key={question.sliceId}
                question={question}
                fieldKey={question.sliceId}
                formId={formId}
                disabled={Boolean(isDisabled)}
              />
            ))}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" disabled={isDisabled} variant="secondary">
              Cancel
            </Button>
          </AlertDialogCancel>

          {isExpiredCheckout ? (
            <>
              <input type="hidden" name="intent" value={intent} form={formId} />
              <Button
                disabled={isDisabled}
                className="flex-1"
                type="submit"
                variant={allowNewEndDate ? "secondary" : "primary"}
                name="checkoutIntentChoice"
                value={CheckoutIntentEnum["without-adjusted-date"]}
                form={formId}
                onClick={closeOnSubmit}
              >
                Check out as overdue
              </Button>

              {allowNewEndDate ? (
                <Button
                  disabled={isDisabled}
                  className="flex-1"
                  type="submit"
                  name="checkoutIntentChoice"
                  value={CheckoutIntentEnum["with-new-end-date"]}
                  form={formId}
                  onClick={closeOnSubmit}
                >
                  Check out with new end date
                </Button>
              ) : null}
            </>
          ) : isEarlyCheckout ? (
            <>
              <input type="hidden" name="intent" value={intent} form={formId} />
              <Button
                disabled={isDisabled}
                className="flex-1"
                type="submit"
                variant="secondary"
                name="checkoutIntentChoice"
                value={CheckoutIntentEnum["without-adjusted-date"]}
                form={formId}
                onClick={closeOnSubmit}
              >
                Don't Adjust Date
              </Button>

              <Button
                disabled={isDisabled}
                className="flex-1"
                type="submit"
                name="checkoutIntentChoice"
                value={CheckoutIntentEnum["with-adjusted-date"]}
                form={formId}
                onClick={closeOnSubmit}
              >
                Adjust Date
              </Button>
            </>
          ) : (
            <Button
              disabled={isDisabled}
              className="flex-1"
              type="submit"
              name="intent"
              value={intent}
              form={formId}
              onClick={closeOnSubmit}
            >
              {unassignedSummary ? "Check out anyway" : "Check out"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
