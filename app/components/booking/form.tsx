import { BookingStatus } from "@prisma/client";
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
import type { BookingWithCustodians } from "~/routes/_layout+/bookings._index";
import { isFormProcessing } from "~/utils/form";
import { ActionsDropdown } from "./actions-dropdown";
import { BookingAssetsColumn } from "./booking-assets-column";
import CustodianSelect from "../custody/custodian-select";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { ControlledActionButton } from "../subscription/premium-feature-button";

type FormData = {
  id?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  custodianId?: string; // This holds the ID of the custodian
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
        return JSON.parse(data).id;
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
  custodianId,
}: FormData) {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewBookingFormSchema);
  const disabled = isFormProcessing(navigation.state);
  const routeIsNewBooking = useLocation().pathname.includes("new");

  const [, updateName] = useAtom(updateDynamicTitleAtom);
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();

  const hasAssets = booking.assets?.length > 0;
  const isReserved = booking.status === BookingStatus.RESERVED;

  return (
    <div>
      <div className="mb-4 mt-[-42px] flex justify-end text-right">
        <div className="flex gap-3">
          {/* We only render the actions when we are not on the .new route */}
          {routeIsNewBooking ? null : <ActionsDropdown booking={booking} />}
        </div>
      </div>
      <div className="mt-5 lg:flex lg:items-start lg:gap-4">
        <div className="mb-8 mt-2 w-full lg:mb-0 lg:w-[328px]">
          <Form
            ref={zo.ref}
            method="post"
            className="flex w-full flex-col gap-3"
          >
            {id ? <input type="hidden" name="id" defaultValue={id} /> : null}
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
                  disabled={disabled || isReserved}
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
                  disabled={disabled || isReserved}
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
                  disabled={disabled || isReserved}
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
                Within this period the assets in this booking will be in custody
                and unavailable for other bookings.
              </p>
            </Card>
            <Card className="m-0">
              <label className="mb-2.5 block font-medium text-gray-700">
                <span className="required-input-label">Custodian</span>
              </label>
              <CustodianSelect
                defaultCustodianId={custodianId}
                disabled={disabled || isReserved}
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
            <div className="mb-4 flex justify-end text-right">
              <div className="flex gap-3">
                <Button
                  type="submit"
                  disabled={disabled}
                  variant="secondary"
                  name="intent"
                  value="save"
                >
                  Save
                </Button>

                {/* When booking is draft, we show the reserve button */}
                {booking.status === BookingStatus.DRAFT ? (
                  <ControlledActionButton
                    canUseFeature={!disabled && hasAssets}
                    buttonContent={{
                      title: "Reserve",
                      message:
                        "You need to add assets to your booking before you can reserve it",
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

                {/* When booking is draft, we show the reserve check-out */}
                {booking.status === BookingStatus.RESERVED ? (
                  <Button
                    type="submit"
                    disabled={disabled}
                    name="intent"
                    value="checkOut"
                  >
                    Check-out
                  </Button>
                ) : null}
              </div>
            </div>
          </Form>
        </div>
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
