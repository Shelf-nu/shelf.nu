import {
  Form,
  useLoaderData,
  useLocation,
  useNavigation,
} from "@remix-run/react";
import { useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { useBookingStatus } from "~/hooks/use-booking-status";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import type { BookingWithCustodians } from "~/routes/_layout+/bookings._index";
import { isFormProcessing } from "~/utils/form";
import { ActionsDropdown } from "./actions-dropdown";
import { BookingAssetsColumn } from "./booking-assets-column";
import CustodianSelect from "../custody/custodian-select";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { ControlledActionButton } from "../shared/controlled-action-button";

type FormData = {
  id?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  custodianUserId?: string; // This holds the ID of the user attached to custodian
};

/**
 * Important note is that the fields are only valudated when they are not disabled
 */
export const NewBookingFormSchema = (inputFieldIsDisabled = false) =>
  z
    .object({
      id: inputFieldIsDisabled ? z.string().optional() : z.string().min(1),
      name: inputFieldIsDisabled
        ? z.string().optional()
        : z.string().min(2, "Name is required"),
      startDate: inputFieldIsDisabled
        ? z.coerce.date().optional()
        : z.coerce.date().refine((data) => data > new Date(), {
            message: "Start date must be in the future",
          }),
      endDate: inputFieldIsDisabled
        ? z.coerce.date().optional()
        : z.coerce.date(),
      custodian: inputFieldIsDisabled
        ? z.string().optional()
        : z.string().transform((val, ctx) => {
            if (!val && val === "") {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Please select a custodian",
              });
              return z.NEVER;
            }
            return JSON.parse(val).userId;
          }),
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

export function BookingForm({
  id,
  name,
  startDate,
  endDate,
  custodianUserId,
}: FormData) {
  const navigation = useNavigation();

  const routeIsNewBooking = useLocation().pathname.includes("new");

  const [, updateName] = useAtom(updateDynamicTitleAtom);
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();

  const {
    hasAssets,
    hasUnavailableAssets,
    isDraft,
    isReserved,
    isOngoing,
    isCompleted,
    isArchived,
    isOverdue,
    isCancelled,
    hasCheckedOutAssets,
  } = useBookingStatus(booking);

  const disabled = isFormProcessing(navigation.state) || isArchived;

  const inputFieldIsDisabled =
    disabled ||
    isReserved ||
    isOngoing ||
    isCompleted ||
    isOverdue ||
    isCancelled;
  const zo = useZorm(
    "NewQuestionWizardScreen",
    NewBookingFormSchema(inputFieldIsDisabled)
  );

  const isSelfService = useUserIsSelfService();

  return (
    <div
      id="bookingFormWrapper"
      className="md:mt-5 xl:flex xl:items-start xl:gap-4"
    >
      <div>
        <Form ref={zo.ref} method="post">
          <div className=" -mx-4 mb-5 flex w-screen items-center justify-between border-b border-gray-200 bg-white px-4 py-2 md:absolute md:right-4 md:top-3 md:m-0 md:w-fit md:justify-end md:border-0 md:bg-transparent md:p-0">
            <div className=" flex gap-2">
              {/* We only render the actions when we are not on the .new route */}
              {routeIsNewBooking ||
              (isDraft && isSelfService) || // When the booking is draft, there are no actions available for selfService so we don't render it
              (isCompleted && isSelfService) ? null : ( // When the booking is Completed, there are no actions available for selfService so we don't render it
                // @ts-ignore
                <ActionsDropdown booking={booking} />
              )}

              {isDraft ? (
                <Button
                  type="submit"
                  disabled={disabled}
                  variant="secondary"
                  name="intent"
                  value="save"
                >
                  Save
                </Button>
              ) : null}

              {/* When booking is draft, we show the reserve button */}
              {isDraft ? (
                <ControlledActionButton
                  canUseFeature={
                    !disabled && hasAssets && !hasUnavailableAssets
                  }
                  buttonContent={{
                    title: "Reserve",
                    message: hasUnavailableAssets
                      ? "You have some assets in your booking that are marked as unavailble. Either remove the assets from this booking or make them available again"
                      : "You need to add assets to your booking before you can reserve it",
                  }}
                  buttonProps={{
                    type: "submit",
                    role: "link",
                    name: "intent",
                    value: "reserve",
                  }}
                  skipCta={true}
                />
              ) : null}

              {/* When booking is reserved, we show the check-out button */}
              {isReserved && !isSelfService ? (
                <ControlledActionButton
                  canUseFeature={
                    !disabled && !hasUnavailableAssets && !hasCheckedOutAssets
                  }
                  buttonContent={{
                    title: "Check-out",
                    message:
                      "Some assets in this booking are not Available because they’re part of an Ongoing or Overdue booking or have assigned custody. Either check-in the missing assets or remove the assets from this booking",
                  }}
                  buttonProps={{
                    type: "submit",
                    name: "intent",
                    value: "checkOut",
                  }}
                  skipCta={true}
                />
              ) : null}

              {(isOngoing || isOverdue) && !isSelfService ? (
                <Button type="submit" name="intent" value="checkIn">
                  Check-in
                </Button>
              ) : null}
            </div>
          </div>
          <div className="">
            <div className="mb-8 w-full xl:mb-0 xl:w-[328px]">
              <div className="flex w-full flex-col gap-3">
                {id ? (
                  <input type="hidden" name="id" defaultValue={id} />
                ) : null}
                <Card className="m-0">
                  <FormRow
                    rowLabel={"Name"}
                    className="mobile-styling-only border-b-0 p-0"
                    //@TODO required={zodFieldIsRequired(NewBookingFormSchema.shape.name)}
                  >
                    <Input
                      label="Name"
                      hideLabel
                      name={zo.fields.name()}
                      disabled={inputFieldIsDisabled}
                      error={zo.errors.name()?.message}
                      autoFocus
                      onChange={updateName}
                      className="mobile-styling-only w-full p-0"
                      defaultValue={name || undefined}
                      placeholder="Booking"
                      // @TODO required={zodFieldIsRequired(NewBookingFormSchema.shape.name)}
                    />
                  </FormRow>
                </Card>
                <Card className="m-0 pt-0">
                  <FormRow
                    rowLabel={"Start Date"}
                    className="mobile-styling-only border-b-0 pb-[10px]"
                    // @TODO required={zodFieldIsRequired(
                    //   NewBookingFormSchema.shape.startDate
                    // )}
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
                      // required={zodFieldIsRequired(
                      //   NewBookingFormSchema.shape.startDate
                      // )}
                    />
                  </FormRow>
                  <FormRow
                    rowLabel={"End Date"}
                    className="mobile-styling-only mb-2.5 border-b-0 p-0"
                    // required={zodFieldIsRequired(NewBookingFormSchema.shape.endDate)}
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
                      // required={zodFieldIsRequired(
                      //   NewBookingFormSchema.shape.endDate
                      // )}
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
                  <CustodianSelect
                    defaultTeamMemberId={custodianUserId}
                    disabled={inputFieldIsDisabled}
                    className={
                      isSelfService
                        ? "pointer-events-none cursor-not-allowed"
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
              </div>
            </div>
          </div>
        </Form>
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
