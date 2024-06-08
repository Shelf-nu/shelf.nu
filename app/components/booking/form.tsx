import { Form, useNavigation } from "@remix-run/react";
import { useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import type { useBookingStatus } from "~/hooks/use-booking-status";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import { type getHints } from "~/utils/client-hints";
import { isFormProcessing } from "~/utils/form";
import { scrollToError } from "~/utils/scroll-to-error";
import { tw } from "~/utils/tw";
import { ActionsDropdown } from "./actions-dropdown";
import CustodianUserSelect from "../custody/custodian-user-select";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { AbsolutePositionedHeaderActions } from "../layout/header/absolute-positioned-header-actions";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { ControlledActionButton } from "../shared/controlled-action-button";

/**
 * Important note is that the fields are only valudated when they are not disabled
 */
export const NewBookingFormSchema = (
  inputFieldIsDisabled = false,
  isNewBooking = false,
  hints?: ReturnType<typeof getHints>
) =>
  z
    .object({
      id:
        inputFieldIsDisabled || isNewBooking
          ? z.string().optional()
          : z.string().min(1),
      name: inputFieldIsDisabled
        ? z.string().optional()
        : z.string().min(2, "Name is required"),
      startDate: inputFieldIsDisabled
        ? z.coerce.date().optional()
        : z.coerce.date().refine(
            (data) => {
              let now;
              if (hints?.timeZone) {
                now = new Date(
                  new Date().toLocaleString("en-US", {
                    timeZone: hints.timeZone,
                  })
                );
              } else {
                now = new Date();
              }
              return data > now;
            },
            {
              message: "Start date must be in the future",
            }
          ),
      endDate: inputFieldIsDisabled
        ? z.coerce.date().optional()
        : z.coerce.date(),
      custodian: z
        .string()
        .transform((val, ctx) => {
          if (!val && val === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Please select a custodian",
            });
            return z.NEVER;
          }
          return JSON.parse(val);
        })
        .pipe(
          z.object({
            id: z.string(),
            name: z.string(),
            userId: z.string().optional().nullable(),
          })
        ),
    })
    .refine(
      (data) =>
        inputFieldIsDisabled ||
        (data.endDate && data.startDate && data.endDate > data.startDate),
      {
        message: "End date cannot be earlier than start date.",
        path: ["endDate"],
      }
    );

type BookingFormData = {
  id?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  custodianUserId?: string; // This is a stringified value for custodianUser
  bookingStatus?: ReturnType<typeof useBookingStatus>;
};

export function BookingForm({
  id,
  name,
  startDate,
  endDate,
  custodianUserId,
  bookingStatus,
}: BookingFormData) {
  const navigation = useNavigation();

  /** If there is noId, that means we are creating a new booking */
  const isNewBooking = !id;

  const [, updateName] = useAtom(updateDynamicTitleAtom);

  const disabled =
    isFormProcessing(navigation.state) || bookingStatus?.isArchived;

  const inputFieldIsDisabled =
    disabled ||
    bookingStatus?.isReserved ||
    bookingStatus?.isOngoing ||
    bookingStatus?.isCompleted ||
    bookingStatus?.isOverdue ||
    bookingStatus?.isCancelled;

  const zo = useZorm(
    "NewQuestionWizardScreen",
    NewBookingFormSchema(inputFieldIsDisabled, isNewBooking)
  );

  const isSelfService = useUserIsSelfService();

  return (
    <div>
      <Form ref={zo.ref} method="post" onSubmit={scrollToError}>
        {/* Render the actions on top only when the form is in edit mode */}
        {!isNewBooking ? (
          <AbsolutePositionedHeaderActions>
            {/* When the booking is Completed, there are no actions available for selfService so we don't render it */}
            {bookingStatus?.isCompleted && isSelfService ? null : (
              <ActionsDropdown />
            )}

            {/*  We show the button in all cases, unless the booking is in a final state */}
            {!(
              bookingStatus?.isCompleted ||
              bookingStatus?.isCancelled ||
              bookingStatus?.isArchived
            ) ? (
              <>
                <input
                  type="hidden"
                  name="nameChangeOnly"
                  value={bookingStatus?.isDraft ? "no" : "yes"}
                />
                <Button
                  type="submit"
                  disabled={disabled}
                  variant="secondary"
                  name="intent"
                  value="save"
                  className="grow"
                  size="sm"
                >
                  Save
                </Button>
              </>
            ) : null}

            {/* When booking is draft, we show the reserve button */}
            {bookingStatus?.isDraft ? (
              <ControlledActionButton
                canUseFeature={
                  !disabled &&
                  bookingStatus?.hasAssets &&
                  !bookingStatus?.hasUnavailableAssets &&
                  !bookingStatus?.hasAlreadyBookedAssets
                }
                buttonContent={{
                  title: "Reserve",
                  message: bookingStatus?.hasUnavailableAssets
                    ? "You have some assets in your booking that are marked as unavailble. Either remove the assets from this booking or make them available again"
                    : bookingStatus?.hasAlreadyBookedAssets
                    ? "Your booking has assets that are already booked for the desired period. You need to resolve that before you can reserve"
                    : "You need to add assets to your booking before you can reserve it",
                }}
                buttonProps={{
                  type: "submit",
                  role: "link",
                  name: "intent",
                  value: "reserve",
                  className: "grow",
                  size: "sm",
                }}
                skipCta={true}
              />
            ) : null}

            {/* When booking is reserved, we show the check-out button */}
            {bookingStatus?.isReserved && !isSelfService ? (
              <ControlledActionButton
                canUseFeature={
                  !disabled &&
                  !bookingStatus?.hasUnavailableAssets &&
                  !bookingStatus?.hasCheckedOutAssets &&
                  !bookingStatus?.hasAssetsInCustody
                }
                buttonContent={{
                  title: "Check-out",
                  message: bookingStatus?.hasAssetsInCustody
                    ? "Some assets in this booking are currently in custody. You need to resolve that before you can check-out"
                    : "Some assets in this booking are not Available because they’re part of an Ongoing or Overdue booking",
                }}
                buttonProps={{
                  type: "submit",
                  name: "intent",
                  value: "checkOut",
                  className: "grow",
                  size: "sm",
                }}
                skipCta={true}
              />
            ) : null}

            {(bookingStatus?.isOngoing || bookingStatus?.isOverdue) &&
            !isSelfService ? (
              <Button
                type="submit"
                name="intent"
                value="checkIn"
                className="grow"
                size="sm"
              >
                Check-in
              </Button>
            ) : null}
          </AbsolutePositionedHeaderActions>
        ) : null}

        <div className="-mx-4 mb-4 md:mx-0">
          <div
            className={tw(
              "mb-8 w-full lg:mb-0 ",
              !isNewBooking ? "lg:w-[328px]" : ""
            )}
          >
            <div className="flex w-full flex-col gap-3">
              {id ? <input type="hidden" name="id" defaultValue={id} /> : null}
              <Card className="m-0">
                <FormRow
                  rowLabel={"Name"}
                  className="mobile-styling-only border-b-0 p-0"
                  required={true}
                >
                  <Input
                    label="Name"
                    hideLabel
                    name={zo.fields.name()}
                    disabled={
                      disabled ||
                      bookingStatus?.isCompleted ||
                      bookingStatus?.isCancelled ||
                      bookingStatus?.isArchived
                    }
                    error={zo.errors.name()?.message}
                    autoFocus
                    onChange={updateName}
                    className="mobile-styling-only w-full p-0"
                    defaultValue={name || undefined}
                    placeholder="Booking"
                    required
                  />
                </FormRow>
              </Card>
              <Card className="m-0 pt-0">
                <FormRow
                  rowLabel={"Start Date"}
                  className="mobile-styling-only border-b-0 pb-[10px]"
                  required
                >
                  <Input
                    label="Start Date"
                    type="datetime-local"
                    hideLabel
                    name={zo.fields.startDate()}
                    disabled={inputFieldIsDisabled}
                    error={zo.errors.startDate()?.message}
                    className="w-full"
                    defaultValue={startDate}
                    placeholder="Booking"
                    required
                  />
                </FormRow>
                <FormRow
                  rowLabel={"End Date"}
                  className="mobile-styling-only mb-2.5 border-b-0 p-0"
                  required
                >
                  <Input
                    label="End Date"
                    type="datetime-local"
                    hideLabel
                    name={zo.fields.endDate()}
                    disabled={inputFieldIsDisabled}
                    error={zo.errors.endDate()?.message}
                    className="w-full"
                    defaultValue={endDate}
                    placeholder="Booking"
                    required
                  />
                </FormRow>
                <p className="text-[14px] text-gray-600">
                  Within this period the assets in this booking will be in
                  custody and unavailable for other bookings.
                </p>
              </Card>
              <Card className="m-0">
                <label className="mb-2.5 block font-medium text-gray-700">
                  <span className="required-input-label">Custodian</span>
                </label>
                <CustodianUserSelect
                  defaultUserId={custodianUserId}
                  disabled={inputFieldIsDisabled}
                  className={
                    isSelfService
                      ? "preview-only-custodian-select pointer-events-none cursor-not-allowed bg-gray-50"
                      : ""
                  }
                  showEmail
                />

                {zo.errors.custodian()?.message ? (
                  <div className="text-sm text-error-500">
                    {zo.errors.custodian()?.message}
                  </div>
                ) : null}
                <p className="mt-2 text-[14px] text-gray-600">
                  The person that will be in custody of or responsible for the
                  assets during the duration of the booking period.
                </p>
              </Card>
              {!isNewBooking && (
                <AddToCalendar
                  disabled={
                    disabled ||
                    bookingStatus?.isDraft ||
                    bookingStatus?.isCancelled ||
                    false
                  }
                />
              )}
            </div>
          </div>
        </div>
        {isNewBooking ? (
          <div className="text-right">
            <Button type="submit">Check Asset Availability</Button>
          </div>
        ) : null}
      </Form>
    </div>
  );
}

const AddToCalendar = ({ disabled }: { disabled: boolean }) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          to={`cal.ics`}
          download={true}
          reloadDocument={true}
          disabled={disabled}
          variant="secondary"
          icon="calendar"
        >
          Add to calendar
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">
          {disabled
            ? "Not possible to add to calendar due to booking status"
            : "Download this booking as a calendar event"}
        </p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
