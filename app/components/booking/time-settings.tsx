import { useRef } from "react";
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

export const TimeSettingsSchema = z.object({
  bufferStartTime: z.coerce
    .number()
    .min(0, "Buffer must be at least 0 hours")
    .max(168, "Buffer cannot exceed 168 hours (7 days)"),
  maxBookingLength: z.coerce
    .number()
    .min(1, "Maximum booking length must be at least 1 hour")
    .max(8760, "Maximum booking length cannot exceed 8760 hours (1 year)")
    .optional()
    .or(z.literal("")),
  maxBookingLengthSkipClosedDays: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export function TimeSettings({
  header,
  defaultBufferValue = 0,
  defaultMaxLengthValue = null,
  defaultMaxBookingLengthSkipClosedDays = false,
}: {
  header: { title: string; subHeading?: string };
  defaultBufferValue: number;
  defaultMaxLengthValue: number | null;
  defaultMaxBookingLengthSkipClosedDays: boolean;
}) {
  const disabled = useDisabled();
  const zo = useZorm("EnableWorkingHoursForm", TimeSettingsSchema);
  const maxBookingLengthSkipClosedDaysRef = useRef<HTMLInputElement>(null);

  const actionData = useActionData<BookingSettingsActionData>();
  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<typeof TimeSettingsSchema>(
    actionData?.error
  );

  return (
    <Card>
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-color-600">{header.subHeading}</p>
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
              defaultValue={defaultBufferValue}
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

          <FormRow
            rowLabel={`Maximum booking length (hours)`}
            subHeading={
              <div>
                Set the maximum duration for a single booking. Leave empty for
                no limit. This helps prevent excessively long bookings.
              </div>
            }
            className="border-b-0 pb-[10px]"
          >
            <div className="flex flex-col">
              <Input
                label="Maximum booking length (hours)"
                hideLabel
                type="number"
                name={zo.fields.maxBookingLength()}
                disabled={disabled}
                defaultValue={defaultMaxLengthValue || ""}
                placeholder="No limit"
                title={"Maximum booking length (hours)"}
                min={1}
                max={8760}
                step={1}
                inputClassName="w-24"
                error={
                  validationErrors?.maxBookingLength?.message ||
                  zo.errors.maxBookingLength()?.message
                }
              />
              <div className="mt-2 flex items-center gap-2">
                <Input
                  id="maxBookingLengthSkipClosedDays"
                  label="Skip closed days"
                  hideLabel
                  type="checkbox"
                  name={zo.fields.maxBookingLengthSkipClosedDays()}
                  disabled={disabled}
                  defaultChecked={
                    defaultMaxBookingLengthSkipClosedDays || false
                  }
                  title={"Skip closed days"}
                  error={
                    validationErrors?.maxBookingLengthSkipClosedDays?.message ||
                    zo.errors.maxBookingLengthSkipClosedDays()?.message
                  }
                  className="inline-block w-[18px]"
                  inputClassName="px-[9px]"
                  ref={maxBookingLengthSkipClosedDaysRef}
                />
                <span
                  onClick={() => {
                    if (maxBookingLengthSkipClosedDaysRef.current) {
                      maxBookingLengthSkipClosedDaysRef.current.click();
                    }
                  }}
                  className="cursor-default"
                >
                  Skip closed days
                </span>
              </div>
              <p className="mt-1 text-sm text-color-500">
                Closed days will not be considered for calculations.
              </p>
            </div>
          </FormRow>

          <div className="text-right">
            <Button
              type="submit"
              disabled={disabled}
              value="updateTimeSettings"
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
