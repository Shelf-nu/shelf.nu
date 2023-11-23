import { Form, useNavigation } from "@remix-run/react";
import { useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { isFormProcessing } from "~/utils/form";
import { zodFieldIsRequired } from "~/utils/zod";
import CustodianSelect from "../custody/custodian-select";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";

type FormData = {
  name?: string;
  startDate?: Date;
  endDate?: Date;
  custodianId?: string; // This holds the ID of the custodian
};

//z.coerce.date() is used to convert the string to a date object.
export const BookingFormSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    startDate: z.coerce.date().refine((data) => data > new Date(), {
      message: "Start date must be in the future",
    }),
    endDate: z.coerce.date(),
    custodianId: z.string().min(1, "Custodian is required").cuid(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date cannot be earlier than start date.",
    path: ["endDate"],
  });

export function BookingForm({
  name,
  startDate,
  endDate,
  custodianId,
}: FormData) {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", BookingFormSchema);
  const disabled = isFormProcessing(navigation.state);

  const [, updateName] = useAtom(updateDynamicTitleAtom);
  return (
    <div className="flex items-center gap-4">
      <div className="w-[328px]"></div>
      <div className="flex-1">
        <Form
          ref={zo.ref}
          method="post"
          className="flex w-full flex-col gap-2"
          encType="multipart/form-data"
        >
          <Card>
            <FormRow
              rowLabel={"Name"}
              className="border-b-0 pb-[10px]"
              required={zodFieldIsRequired(BookingFormSchema.shape.name)}
            >
              <Input
                label="Name"
                hideLabel
                name={zo.fields.name()}
                disabled={disabled}
                error={zo.errors.name()?.message}
                autoFocus
                onChange={updateName}
                className="w-full"
                defaultValue={name || undefined}
                placeholder="Booking"
                required={zodFieldIsRequired(BookingFormSchema.shape.name)}
              />
            </FormRow>
          </Card>
          <Card>
            <FormRow
              rowLabel={"Start Date"}
              className="border-b-0 pb-[10px]"
              required={zodFieldIsRequired(BookingFormSchema.shape.startDate)}
            >
              <Input
                label="Start Date"
                type="datetime-local"
                hideLabel
                name={zo.fields.startDate()}
                disabled={disabled}
                error={zo.errors.startDate()?.message}
                autoFocus
                onChange={updateName}
                className="w-full"
                defaultValue={startDate || undefined}
                placeholder="Booking"
                required={zodFieldIsRequired(BookingFormSchema.shape.startDate)}
              />
            </FormRow>
            <FormRow
              rowLabel={"End Date"}
              className="border-b-0 pb-[10px]"
              required={zodFieldIsRequired(BookingFormSchema.shape.endDate)}
            >
              <Input
                label="End Date"
                type="datetime-local"
                hideLabel
                name={zo.fields.endDate()}
                disabled={disabled}
                error={zo.errors.endDate()?.message}
                autoFocus
                onChange={updateName}
                className="w-full"
                defaultValue={endDate || undefined}
                placeholder="Booking"
                required={zodFieldIsRequired(BookingFormSchema.shape.endDate)}
              />
            </FormRow>
            <p className="text-[14px] text-gray-600">
              Within this period the assets in this booking will be in custody
              and unavailable for other bookings.
            </p>
          </Card>
          <Card>
            <CustodianSelect />
            <p className="text-[14px] text-gray-600">
              The person that will be in custody of or responsible for the
              assets during the duration of the booking period.
            </p>
          </Card>

          <div className="text-right">
            <Button type="submit" disabled={disabled}>
              {disabled ? <Spinner /> : "Save"}
            </Button>
          </div>
        </Form>
      </div>
    </div>
  );
}
