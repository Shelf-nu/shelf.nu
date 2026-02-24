import { useState } from "react";
import { useFetcher, useActionData } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import { Form } from "~/components/custom-form";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Spinner } from "~/components/shared/spinner";
import { useDisabled } from "~/hooks/use-disabled";
import type { BookingSettingsActionData } from "~/routes/_layout+/settings.bookings";
import { getValidationErrors } from "~/utils/http";

export const AutoArchiveToggleSchema = z.object({
  autoArchiveBookings: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export const AutoArchiveDaysSchema = z.object({
  autoArchiveDays: z.coerce
    .number()
    .int("Must be a whole number")
    .min(1, "Must be at least 1 day")
    .max(365, "Cannot exceed 365 days"),
});

export function AutoArchiveSettings({
  header,
  defaultAutoArchiveBookings = false,
  defaultAutoArchiveDays = 2,
}: {
  header: { title: string; subHeading?: string };
  defaultAutoArchiveBookings: boolean;
  defaultAutoArchiveDays: number;
}) {
  const fetcher = useFetcher();
  const toggleDisabled = useDisabled(fetcher);
  const daysDisabled = useDisabled();
  const [isEnabled, setIsEnabled] = useState(defaultAutoArchiveBookings);

  const toggleZo = useZorm("AutoArchiveToggleForm", AutoArchiveToggleSchema);
  const daysZo = useZorm("AutoArchiveDaysForm", AutoArchiveDaysSchema);

  const actionData = useActionData<BookingSettingsActionData>();
  const validationErrors = getValidationErrors<typeof AutoArchiveDaysSchema>(
    actionData?.error
  );

  return (
    <Card className="my-0">
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-gray-600">{header.subHeading}</p>
      </div>
      <div>
        {/* Toggle form - auto-submits on change */}
        <fetcher.Form
          ref={toggleZo.ref}
          method="post"
          onChange={(e) => {
            const form = e.currentTarget;
            const checkbox = form.elements.namedItem(
              toggleZo.fields.autoArchiveBookings()
            ) as HTMLInputElement;
            if (checkbox) {
              setIsEnabled(checkbox.checked);
            }
            void fetcher.submit(form);
          }}
        >
          <FormRow
            rowLabel="Auto-archive completed bookings"
            subHeading={
              <div>
                Automatically move completed bookings to Archived after they've
                been completed for the specified number of days.
              </div>
            }
            className="border-b-0 pb-[10px] pt-0"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                name={toggleZo.fields.autoArchiveBookings()}
                disabled={toggleDisabled}
                defaultChecked={defaultAutoArchiveBookings}
                aria-label="Auto-archive completed bookings"
                title="Auto-archive completed bookings"
              />
            </div>
          </FormRow>
          <input type="hidden" value="updateAutoArchiveToggle" name="intent" />
        </fetcher.Form>

        {/* Days form - standard form with Save button, only shown when enabled */}
        {isEnabled && (
          <Form ref={daysZo.ref} method="post">
            <FormRow
              rowLabel="Days after completion"
              subHeading={
                <div>
                  Number of days to wait after a booking is completed before
                  automatically archiving it.
                </div>
              }
              className="border-b-0 pb-[10px]"
              required
            >
              <Input
                label="Days after completion"
                hideLabel
                type="number"
                name={daysZo.fields.autoArchiveDays()}
                disabled={daysDisabled}
                defaultValue={defaultAutoArchiveDays}
                required
                title="Days after completion"
                min={1}
                max={365}
                step={1}
                inputClassName="w-24"
                error={
                  validationErrors?.autoArchiveDays?.message ||
                  daysZo.errors.autoArchiveDays()?.message
                }
              />
            </FormRow>

            <div className="text-right">
              <Button
                type="submit"
                disabled={daysDisabled}
                value="updateAutoArchiveDays"
                name="intent"
              >
                {daysDisabled ? <Spinner /> : "Save settings"}
              </Button>
            </div>
          </Form>
        )}
      </div>
    </Card>
  );
}
