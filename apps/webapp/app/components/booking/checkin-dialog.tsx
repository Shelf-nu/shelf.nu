/**
 * Check-in confirmation for a booking.
 *
 * Every check-in goes through this dialog, so a single click can never
 * complete a booking. It also owns the early check-in rule: more than 15
 * minutes before the end, the user picks whether the end date moves to now.
 *
 * @see {@link file://./checkin-dropdown.tsx} the booking header's Check-in menu
 * @see {@link file://./bulk-partial-checkin-dialog.tsx} final partial check-in
 * @see {@link file://../scanner/drawer/uses/partial-checkin-drawer.tsx} scanner
 */
import type { ReactNode } from "react";
import type { Booking } from "@prisma/client";
import { Zap } from "lucide-react";
import { useDisabled } from "~/hooks/use-disabled";
import { isBookingEarlyCheckin } from "~/modules/booking/helpers";
import { tw } from "~/utils/tw";
import { Button, type ButtonProps } from "../shared/button";
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

export enum CheckinIntentEnum {
  "with-adjusted-date" = "with-adjusted-date",
  "without-adjusted-date" = "without-adjusted-date",
}

type CheckinDialogProps = {
  disabled?: ButtonProps["disabled"];
  booking: Pick<Booking, "id" | "name" | "from" | "to">;
  /** A container to render the AlertContent inside */
  portalContainer?: HTMLElement;
  /** Form ID for explicit form association when buttons render in a portal */
  formId?: string;
  /**
   * The form `intent` the buttons submit. Defaults to the header's
   * whole-booking `checkIn`. The "Check in selected items" dialog passes
   * `partial-checkin`, so the overview routes its early final check-in through
   * `checkinAssets`, which records the batch as selected and applies the date
   * choice, rather than the one-click path the explicit-rule guard refuses.
   */
  intent?: string;

  /** Callback to close parent dropdown/menu */
  onClose?: () => void;
  /** Custom label for the button */
  label?: string;
  /**
   * Variant for different contexts. `"icon"` renders a compact secondary
   * button showing only `icon`, with `label` as its tooltip and accessible
   * name, for a list row's actions.
   */
  variant?: "default" | "dropdown" | "primary" | "icon";
  /** The trigger's icon when `variant` is `"icon"`. */
  icon?: ReactNode;
  /** Specific asset IDs for enhanced completion messaging */
  specificAssetIds?: string[];
  /** Render the trigger button full-width to match a sibling full-width button. */
  fullWidth?: boolean;
};

/**
 * Trigger button plus "Check in booking" dialog. The dialog submits
 * `formId` with `intent` and, depending on timing:
 *
 * - not early: no `checkinIntentChoice`, the end date is kept
 * - early, after the start: "Don't Adjust Date" or "Adjust Date"
 * - early, before the start: `without-adjusted-date`, because the end date
 *   cannot move to a time before the start
 *
 * @param props - See {@link CheckinDialogProps}
 */
export default function CheckinDialog({
  disabled,
  booking,
  portalContainer,
  formId,
  intent = "checkIn",
  label = "Check-in",
  variant = "default",
  icon,
  specificAssetIds,
  fullWidth = false,
}: CheckinDialogProps) {
  const isEarlyCheckin = isBookingEarlyCheckin(booking.to);
  const isNavigating = useDisabled();
  const isDisabled = disabled || isNavigating;

  /**
   * We have to make sure the current time is before the `from` date of the booking. See details: https://github.com/Shelf-nu/shelf.nu/issues/1839
   */
  const currentTimeIsBeforeFrom =
    isEarlyCheckin && new Date() < new Date(booking.from);

  /** Early check-ins after the start ask whether to move the end date to now. */
  const asksDateChoice = isEarlyCheckin && !currentTimeIsBeforeFrom;

  const assetCount = specificAssetIds?.length ?? 0;
  const scopeLabel =
    assetCount > 0
      ? `${assetCount} asset${assetCount !== 1 ? "s" : ""}`
      : "every asset";

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {variant === "icon" ? (
          <Button
            type="button"
            disabled={isDisabled}
            size="sm"
            variant="secondary"
            className="p-2"
            aria-label={label}
            tooltip={label}
          >
            {icon}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={isDisabled}
            className={tw(
              "whitespace-nowrap",
              variant === "dropdown"
                ? "w-full justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
                : ""
            )}
            variant={variant === "dropdown" ? "link" : "primary"}
            width={variant === "dropdown" || fullWidth ? "full" : undefined}
          >
            {variant === "dropdown" ? (
              <span className="flex items-center gap-2">
                <Zap className="size-4" /> {label}
              </span>
            ) : (
              label
            )}
          </Button>
        )}
      </AlertDialogTrigger>

      <AlertDialogContent portalProps={{ container: portalContainer }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Check in booking</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription>
          This checks in {scopeLabel} of{" "}
          <span className="font-bold text-gray-700">{booking.name}</span> and
          completes the booking.
          {isEarlyCheckin ? (
            <>
              <br />
              <br />
              {currentTimeIsBeforeFrom ? (
                <>
                  You are checking in the booking more than 15 minutes before
                  the end date, however you are not allowed to adjust the end
                  date because the current time(
                  <span className="font-bold text-gray-700">
                    <DateS date={new Date()} includeTime />
                  </span>
                  ) is before the start date(
                  <span className="font-bold text-gray-700">
                    <DateS date={booking.from} includeTime />
                  </span>
                  ) of the booking.
                </>
              ) : (
                <>
                  You are checking in the booking more than 15 minutes before
                  the end date. Adjust Date moves the end date to now (
                  <span className="font-bold text-gray-700">
                    <DateS date={new Date()} includeTime />
                  </span>
                  ). Don't Adjust Date keeps the original end date.
                </>
              )}
            </>
          ) : null}
        </AlertDialogDescription>

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button
              disabled={isDisabled}
              variant="secondary"
              type="button"
              className={asksDateChoice ? "" : "flex-1"}
            >
              Cancel
            </Button>
          </AlertDialogCancel>

          <input type="hidden" name="intent" value={intent} form={formId} />

          {/* Pass specific asset IDs for enhanced completion messaging */}
          {specificAssetIds?.map((assetId) => (
            <input
              key={assetId}
              type="hidden"
              name="specificAssetIds[]"
              value={assetId}
              form={formId}
            />
          ))}

          {asksDateChoice ? (
            <>
              <Button
                disabled={isDisabled}
                className="flex-1"
                type="submit"
                form={formId}
                variant="secondary"
                name="checkinIntentChoice"
                value={CheckinIntentEnum["without-adjusted-date"]}
              >
                Don't Adjust Date
              </Button>
              <Button
                disabled={isDisabled}
                className="flex-1"
                width={"full"}
                type="submit"
                form={formId}
                name="checkinIntentChoice"
                value={CheckinIntentEnum["with-adjusted-date"]}
              >
                Adjust Date
              </Button>
            </>
          ) : (
            <Button
              disabled={isDisabled}
              className="flex-1"
              type="submit"
              form={formId}
              variant="primary"
              // An early check-in before the start cannot move the end date, so
              // it keeps the original one; a normal check-in sends no choice.
              {...(currentTimeIsBeforeFrom && {
                name: "checkinIntentChoice",
                value: CheckinIntentEnum["without-adjusted-date"],
              })}
            >
              Check in
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
