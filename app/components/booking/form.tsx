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

//z.coerce.date() is used to convert the string to a date object.
export const NewBookingFormSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(2, "Name is required"),
    startDate: z.coerce.date().refine((data) => data > new Date(), {
      message: "Start date must be in the future",
    }),
    endDate: z.coerce.date(),
    custodian: z.coerce
      .string()

      .transform((data) => {
        if (data === "") {
          throw new Error("Custodian is required");
        }
        /** We get the userId because custody in a booking can be assigned only to users(for now), not to NRM */
        return JSON.parse(data).userId;
      }),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date cannot be earlier than start date.",
    path: ["endDate"],
  });

export function BookingForm({
  id,
  name,
  startDate,
  endDate,
  custodianUserId,
}: FormData) {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewBookingFormSchema);
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
  } = useBookingStatus(booking);

  const disabled = isFormProcessing(navigation.state) || isArchived;

  const inputFieldIsDisabled =
    disabled || isReserved || isOngoing || isCompleted || isOverdue;

  return (
    <div
      id="bookingFormWrapper"
      className="relative mt-5 lg:flex lg:items-start lg:gap-4"
    >
      <div>
        <Form ref={zo.ref} method="post">
          <div className="absolute mt-[-70px] flex w-full justify-end text-right">
            <div className=" flex gap-2">
              {/* We only render the actions when we are not on the .new route */}
              {/* @ts-ignore */}
              {routeIsNewBooking ? null : <ActionsDropdown booking={booking} />}

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
              {isReserved ? (
                <ControlledActionButton
                  canUseFeature={!disabled && !hasUnavailableAssets}
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

              {isOngoing || isOverdue ? (
                <Button type="submit" name="intent" value="checkIn">
                  Check-in
                </Button>
              ) : null}
            </div>
          </div>
          <div className="">
            <div className="mb-8 w-full lg:mb-0 lg:w-[328px]">
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
