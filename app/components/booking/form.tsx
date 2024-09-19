import { useNavigation } from "@remix-run/react";
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
import type { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { type getHints } from "~/utils/client-hints";
import { isFormProcessing } from "~/utils/form";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { ActionsDropdown } from "./actions-dropdown";
import CustodianUserSelect from "../custody/custodian-user-select";
import { Form } from "../custom-form";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { AbsolutePositionedHeaderActions } from "../layout/header/absolute-positioned-header-actions";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import When from "../when/when";

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
      assetIds: z.array(z.string()).optional(),
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
      description: z.string().optional(),
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

type BookingFlags = {
  hasAssets: boolean;
  hasUnavailableAssets: boolean;
  hasCheckedOutAssets: boolean;
  hasAlreadyBookedAssets: boolean;
  hasAssetsInCustody: boolean;
};

type BookingFormData = {
  id?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  custodianUserId?: string; // This is a stringified value for custodianUser
  bookingStatus?: ReturnType<typeof useBookingStatusHelpers>;
  bookingFlags?: BookingFlags;
  assetIds?: string[] | null;
  description?: string | null;
};

export function BookingForm({
  id,
  name,
  startDate,
  endDate,
  custodianUserId,
  bookingStatus,
  bookingFlags,
  assetIds,
  description,
}: BookingFormData) {
  const navigation = useNavigation();

  /** If there is noId, that means we are creating a new booking */
  const isNewBooking = !id;

  const [, updateName] = useAtom(updateDynamicTitleAtom);

  const isProcessing = isFormProcessing(navigation.state);

  const disabled = isProcessing || bookingStatus?.isArchived;

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

  const { roles, isBaseOrSelfService } = useUserRoleHelper();

  const canCheckInBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.checkin,
  });
  const canCheckOutBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.checkout,
  });

  return (
    <div>
      <Form ref={zo.ref} method="post">
        {/* Render the actions on top only when the form is in edit mode */}
        {!isNewBooking ? (
          <AbsolutePositionedHeaderActions>
            {/* When the booking is Completed, there are no actions available for BASE role so we don't render it */}
            <ActionsDropdown />

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
              <Button
                disabled={
                  disabled ||
                  !bookingFlags?.hasAssets ||
                  bookingFlags?.hasAlreadyBookedAssets ||
                  bookingFlags?.hasUnavailableAssets
                    ? {
                        reason: bookingFlags?.hasUnavailableAssets
                          ? "You have some assets in your booking that are marked as unavailble. Either remove the assets from this booking or make them available again"
                          : bookingFlags?.hasAlreadyBookedAssets
                          ? "Your booking has assets that are already booked for the desired period. You need to resolve that before you can reserve"
                          : isProcessing
                          ? undefined
                          : "You need to add assets to your booking before you can reserve it",
                      }
                    : false
                }
                type="submit"
                name="intent"
                value="reserve"
                className="grow"
                size="sm"
              >
                Reserve
              </Button>
            ) : null}

            {/* When booking is reserved, we show the check-out button */}
            <When truthy={bookingStatus?.isReserved && canCheckOutBooking}>
              <Button
                disabled={
                  disabled ||
                  bookingFlags?.hasUnavailableAssets ||
                  bookingFlags?.hasCheckedOutAssets ||
                  bookingFlags?.hasAssetsInCustody
                    ? {
                        reason: bookingFlags?.hasAssetsInCustody
                          ? "Some assets in this booking are currently in custody. You need to resolve that before you can check-out"
                          : isProcessing
                          ? undefined
                          : "Some assets in this booking are not Available because they’re part of an Ongoing or Overdue booking",
                      }
                    : false
                }
                type="submit"
                name="intent"
                value="checkOut"
                className="grow"
                size="sm"
              >
                Check Out
              </Button>
            </When>

            <When
              truthy={
                (bookingStatus?.isOngoing || bookingStatus?.isOverdue) &&
                canCheckInBooking
              }
            >
              <Button
                disabled={disabled}
                type="submit"
                name="intent"
                value="checkIn"
                className="grow"
                size="sm"
              >
                Check-in
              </Button>
            </When>
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
              <Card className="m-0">
                <FormRow
                  rowLabel={"Start Date"}
                  className="mobile-styling-only border-b-0 pb-[10px] pt-0"
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
                    isBaseOrSelfService
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
              <Card className="m-0">
                <FormRow
                  rowLabel="Description"
                  className="mobile-styling-only border-b-0 p-0"
                >
                  <Input
                    label="Description"
                    inputType="textarea"
                    hideLabel
                    name={zo.fields.description()}
                    disabled={
                      disabled ||
                      bookingStatus?.isCompleted ||
                      bookingStatus?.isCancelled ||
                      bookingStatus?.isArchived
                    }
                    error={zo.errors.description()?.message}
                    className="mobile-styling-only w-full p-0"
                    defaultValue={description || undefined}
                    placeholder="Add a description..."
                  />
                </FormRow>
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
          <Card className="sticky bottom-0 -mx-6 mb-0 rounded-none border-0 px-6 py-0 text-right">
            <div className="-mx-6 mb-3 border-t shadow" />
            {assetIds?.map((item, i) => (
              <input
                key={item}
                type="hidden"
                name={`assetIds[${i}]`}
                value={item}
              />
            ))}
            <div className="flex flex-col">
              {!assetIds ? (
                <Button
                  icon="scan"
                  className="mb-1"
                  type="submit"
                  disabled={disabled}
                  value="scan"
                  name="intent"
                >
                  Scan QR codes
                </Button>
              ) : null}
              <Button
                className="mb-3 whitespace-nowrap"
                icon="rows"
                value="create"
                name="intent"
                disabled={disabled}
              >
                {assetIds ? "Create Booking" : "View assets list"}
              </Button>
              <hr />
              <Button
                variant="secondary"
                to=".."
                width="full"
                disabled={disabled}
                className=" mt-3 whitespace-nowrap"
              >
                Cancel
              </Button>
            </div>
            <div className="h-3" />
          </Card>
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
