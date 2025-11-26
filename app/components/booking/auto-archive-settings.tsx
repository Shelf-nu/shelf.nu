import { useState } from "react";
import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import { Card } from "~/components/shared/card";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";

export const AutoArchiveSettingsSchema = z.object({
  autoArchiveBookings: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
  autoArchiveDays: z.coerce
    .number()
    .min(1, "Must be at least 1 day")
    .max(365, "Cannot exceed 365 days")
    .default(2),
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
  const disabled = useDisabled();
  const zo = useZorm("AutoArchiveForm", AutoArchiveSettingsSchema);
  const [isEnabled, setIsEnabled] = useState(defaultAutoArchiveBookings);

  const handleSubmit = (form: HTMLFormElement) => {
    fetcher.submit(form);
  };

  return (
    <Card className={tw("my-0")}>
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-gray-600">{header.subHeading}</p>
      </div>
      <div>
        <fetcher.Form
          ref={zo.ref}
          method="post"
          onChange={(e) => {
            const form = e.currentTarget;
            // Update local state for controlled visibility
            const checkbox = form.elements.namedItem(
              zo.fields.autoArchiveBookings()
            ) as HTMLInputElement;
            if (checkbox) {
              setIsEnabled(checkbox.checked);
            }
            handleSubmit(form);
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
                name={zo.fields.autoArchiveBookings()}
                disabled={disabled}
                defaultChecked={defaultAutoArchiveBookings}
                title="Auto-archive completed bookings"
              />
              <label
                htmlFor={`autoArchiveBookings-${zo.fields.autoArchiveBookings()}`}
                className="hidden text-gray-500"
              >
                Auto-archive completed bookings
              </label>
            </div>
          </FormRow>

          {isEnabled && (
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
                name={zo.fields.autoArchiveDays()}
                disabled={disabled}
                defaultValue={defaultAutoArchiveDays}
                required
                title="Days after completion"
                min={1}
                max={365}
                step={1}
                inputClassName="w-24"
                error={zo.errors.autoArchiveDays()?.message}
              />
            </FormRow>
          )}

          <input type="hidden" value="updateAutoArchive" name="intent" />
        </fetcher.Form>
      </div>
    </Card>
  );
}
