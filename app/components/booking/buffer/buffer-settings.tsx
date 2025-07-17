import { useActionData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import z from "zod";
import { Form } from "~/components/custom-form";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Spinner } from "~/components/shared/spinner";
import { useDisabled } from "~/hooks/use-disabled";
import type { BookingSettingsActionData } from "~/routes/_layout+/settings.bookings";
import { getValidationErrors } from "~/utils/http";
import { tw } from "~/utils/tw";

export const TimeSettingsSchema = z.object({
  bufferStartTime: z.coerce
    .number()
    .min(0, "Buffer must be at least 0 hours")
    .max(168, "Buffer cannot exceed 168 hours (7 days)"),
});

export function TimeSettings({
  header,
  defaultValue = 0,
}: {
  header: { title: string; subHeading?: string };
  defaultValue: number;
}) {
  const disabled = useDisabled();
  const zo = useZorm("EnableWorkingHoursForm", TimeSettingsSchema);

  const actionData = useActionData<BookingSettingsActionData>();
  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<typeof TimeSettingsSchema>(
    actionData?.error
  );

  return (
    <Card className={tw("my-0")}>
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-gray-600">{header.subHeading}</p>
      </div>
      <div>
        <Form ref={zo.ref} method="post">
          <FormRow
            rowLabel={`Minimum advance notice (hours)`}
            subHeading={
              <div>
                Users must book at least this many hours ahead of their booking
                start time. Enter 0 to allow immediate bookings. This limitation
                is only valid for <strong>Self service</strong> &{" "}
                <strong>Base</strong> users.
              </div>
            }
            className="border-b-0 pb-[10px] pt-0"
            required
          >
            <Input
              label="Minimum advance notice (hours)"
              hideLabel
              type="number"
              name={zo.fields.bufferStartTime()}
              disabled={disabled}
              defaultValue={defaultValue}
              required
              title={"Minimum advance notice (hours)"}
              min={0}
              max={168}
              step={1}
              inputClassName="w-24"
              error={
                validationErrors?.bufferStartTime?.message ||
                zo.errors.bufferStartTime()?.message
              }
            />
          </FormRow>

          <div className="text-right">
            <Button
              type="submit"
              disabled={disabled}
              value="updateBuffer"
              name="intent"
            >
              {disabled ? <Spinner /> : "Save settings"}
            </Button>
          </div>
        </Form>
      </div>
    </Card>
  );
}
