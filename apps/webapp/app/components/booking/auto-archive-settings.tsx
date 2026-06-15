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

export const AutoArchiveExpiredToggleSchema = z.object({
  autoArchiveExpiredReservations: z
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
  defaultAutoArchiveExpiredReservations = false,
  defaultAutoArchiveDays = 2,
}: {
  header: { title: string; subHeading?: string };
  defaultAutoArchiveBookings: boolean;
  defaultAutoArchiveExpiredReservations: boolean;
  defaultAutoArchiveDays: number;
}) {
  const fetcher = useFetcher();
  const toggleDisabled = useDisabled(fetcher);
  const expiredFetcher = useFetcher();
  const expiredToggleDisabled = useDisabled(expiredFetcher);
  const daysDisabled = useDisabled();
  // Lazy initializer avoids a false-positive derived-state lint: this drives optimistic
  // UI for the toggle. After mount it's user-controlled; it must NOT re-sync with the
  // server-provided default (that would overwrite the optimistic value before the
  // fetcher revalidates).
  const [isEnabled, setIsEnabled] = useState(() => defaultAutoArchiveBookings);
  const [isExpiredEnabled, setIsExpiredEnabled] = useState(
    () => defaultAutoArchiveExpiredReservations
  );

  const toggleZo = useZorm("AutoArchiveToggleForm", AutoArchiveToggleSchema);
  const expiredToggleZo = useZorm(
    "AutoArchiveExpiredToggleForm",
    AutoArchiveExpiredToggleSchema
  );
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

        {/* Expired-reservation toggle - auto-submits on change */}
        <expiredFetcher.Form
          ref={expiredToggleZo.ref}
          method="post"
          onChange={(e) => {
            const form = e.currentTarget;
            const checkbox = form.elements.namedItem(
              expiredToggleZo.fields.autoArchiveExpiredReservations()
            ) as HTMLInputElement;
            if (checkbox) {
              setIsExpiredEnabled(checkbox.checked);
            }
            void expiredFetcher.submit(form);
          }}
        >
          <FormRow
            rowLabel="Auto-archive reserved bookings after their end date"
            subHeading={
              <div>
                Automatically move reserved bookings to Archived once their end
                date has passed without ever being checked out — for teams that
                use bookings as a reservation calendar.
              </div>
            }
            className="border-b-0 pb-[10px] pt-0"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                name={expiredToggleZo.fields.autoArchiveExpiredReservations()}
                disabled={expiredToggleDisabled}
                defaultChecked={defaultAutoArchiveExpiredReservations}
                aria-label="Auto-archive reserved bookings after their end date"
                title="Auto-archive reserved bookings after their end date"
              />
            </div>
          </FormRow>
          <input
            type="hidden"
            value="updateAutoArchiveExpiredToggle"
            name="intent"
          />
        </expiredFetcher.Form>

        {/* Days form - shared by both toggles, shown when either is enabled */}
        {(isEnabled || isExpiredEnabled) && (
          <Form ref={daysZo.ref} method="post">
            <FormRow
              rowLabel="Days before auto-archiving"
              subHeading={
                <div>
                  Number of days to wait after a booking is completed (or its
                  reservation's end date has passed) before automatically
                  archiving it.
                </div>
              }
              className="border-b-0 pb-[10px]"
              required
            >
              <Input
                label="Days before auto-archiving"
                hideLabel
                type="number"
                name={daysZo.fields.autoArchiveDays()}
                disabled={daysDisabled}
                defaultValue={defaultAutoArchiveDays}
                required
                title="Days before auto-archiving"
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
