import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { Form, useLoaderData, useLocation, useActionData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import { useSearchParams } from "~/hooks/search-params";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import {
  REMINDER_REPEAT_PRESETS,
  REMINDER_REPEAT_VALUES,
  resolveRecurrenceZone,
  type ReminderRepeatValue,
} from "~/modules/asset-reminder/recurrence";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import TeamMembersSelector from "./team-members-selector";
import { Dialog, DialogPortal } from "../layout/dialog";

const baseReminderSchema = z.object({
  name: z.string().min(1, "Please enter name."),
  message: z.string().min(1, "Please enter message."),
  alertDateTime: z.coerce.date(),
  teamMembers: z
    .array(z.string())
    .min(1, "Please select at least one team member"),
  repeat: z.enum(REMINDER_REPEAT_VALUES).default("never"),
  // why preprocess: an empty optional date input submits "" through the
  // multipart form, and z.coerce.date() would turn "" into Invalid Date
  endsAt: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.date().optional()
  ),
  redirectTo: z.string().optional(),
});

/**
 * CLIENT-ONLY endsAt ordering check, comparing CALENDAR DAYS rather than
 * instants. The two inputs coerce differently: a type="date" string parses
 * at UTC midnight while a datetime-local string parses in the browser's
 * local zone — comparing the raw instants wrongly rejected valid same-day
 * evening reminders for users west of UTC. The endsAt calendar day is the
 * UTC date of the coerced value; the reminder's calendar day is its LOCAL
 * date. The authoritative server check runs on the zone-resolved values in
 * resolveReminderPayloadDates.
 */
function clientEndsAtOrderingRefinement(
  data: z.infer<typeof baseReminderSchema>,
  ctx: z.RefinementCtx
) {
  if (data.repeat === "never" || !data.endsAt) return;

  const endsDay = data.endsAt.toISOString().slice(0, 10);
  const alert = data.alertDateTime;
  const alertDay = `${alert.getFullYear()}-${String(
    alert.getMonth() + 1
  ).padStart(2, "0")}-${String(alert.getDate()).padStart(2, "0")}`;

  if (endsDay < alertDay) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "End date must be on or after the reminder date",
    });
  }
}

/**
 * CLIENT-ONLY future check. In the browser, z.coerce.date() parses the
 * datetime-local string in the user's own zone, so comparing against
 * Date.now() is correct. On the SERVER the same coercion runs in the
 * process zone (UTC in prod) and would wrongly reject valid future times
 * for users west of UTC — the authoritative server check happens in
 * resolveReminderPayloadDates against the client-hint-resolved instant.
 * (Evaluated at parse time; the previous `.min(new Date())` snapshotted
 * boot time.)
 */
function clientFutureRefinement(
  data: z.infer<typeof baseReminderSchema>,
  ctx: z.RefinementCtx
) {
  if (data.alertDateTime.getTime() <= Date.now()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["alertDateTime"],
      message: "Please select a date in the future",
    });
  }
}

/** Client-side schema (zorm): calendar-day ordering + zone-correct future check. */
export const setReminderSchema = baseReminderSchema
  .superRefine(clientEndsAtOrderingRefinement)
  .superRefine(clientFutureRefinement);

/**
 * Server-side parse schemas: NO date refinements — server-side coercion runs
 * in the process zone, not the user's, so both the future check and the
 * endsAt ordering check are enforced by resolveReminderPayloadDates on the
 * client-hint-resolved instants instead.
 */
export const setReminderServerSchema = baseReminderSchema;

/** Edit adds the reminder id; consumed by resolveRemindersActions. */
export const editReminderServerSchema = baseReminderSchema.extend({
  id: z.string(),
});

type SetOrEditReminderDialogProps = {
  open: boolean;
  onClose: () => void;
  reminder?: Omit<z.infer<typeof setReminderSchema>, "repeat" | "endsAt"> & {
    id: string;
    repeat?: ReminderRepeatValue;
    endsAt?: Date | string | null;
    recurrenceTimezone?: string | null;
  };
  action?: string;
};

/**
 * Reads the tier capability exposed by every route that renders this dialog
 * (asset detail, global reminders index, asset reminders tab). Fails CLOSED
 * (locked UI) if a future surface forgets to expose it — the server asserts
 * independently either way.
 */
function useCanUseRecurringReminders(): boolean {
  const data = useLoaderData() as
    | { canUseRecurringReminders?: boolean }
    | undefined;
  return data?.canUseRecurringReminders ?? false;
}

export default function SetOrEditReminderDialog({
  open,
  onClose,
  reminder,
  action,
}: SetOrEditReminderDialogProps) {
  const disabled = useDisabled();

  const pathname = useLocation().pathname;
  const [searchParams, setSearchParams] = useSearchParams();
  const canUseRecurringReminders = useCanUseRecurringReminders();

  const redirectTo = `${pathname}${
    searchParams.size > 0
      ? `?${searchParams.toString()}&success=true`
      : "?success=true"
  }`;

  const zo = useZorm("SetOrEditReminder", setReminderSchema);

  const actionData = useActionData<DataOrErrorResponse>();
  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<typeof setReminderSchema>(
    actionData?.error
  );

  const isEdit = !!reminder;
  const initialRepeat: ReminderRepeatValue = reminder?.repeat ?? "never";
  const [repeat, setRepeat] = useState<ReminderRepeatValue>(initialRepeat);

  /**
   * Reset the Repeat selection whenever the dialog (re)opens — useState only
   * seeds once, so without this a changed-then-cancelled cadence would leak
   * into the next open and could be submitted unintentionally.
   */
  useEffect(() => {
    if (open) {
      setRepeat(initialRepeat);
    }
  }, [open, initialRepeat]);

  /** Ref for the first field so we can focus it on open without autoFocus. */
  const nameInputRef = useAutoFocus<HTMLInputElement>({ when: open });

  useEffect(
    function handleOnSuccess() {
      if (searchParams.get("success") === "true") {
        onClose && onClose();

        setSearchParams((prev) => {
          prev.delete("success");
          return prev;
        });
      }
    },
    [onClose, searchParams, setSearchParams]
  );

  // why: recurrenceEndsAt is stored as end-of-day in the reminder's own
  // timezone. Render the calendar date back in THAT zone (not UTC via
  // toISOString) so the date shown matches what was picked and does not drift
  // +1 day per save for west-of-UTC workspaces.
  const endsAtDefault = reminder?.endsAt
    ? DateTime.fromJSDate(new Date(reminder.endsAt))
        .setZone(resolveRecurrenceZone(reminder.recurrenceTimezone ?? null))
        .toFormat("yyyy-MM-dd")
    : undefined;

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={onClose}
        className="md:w-[800px]"
        headerClassName="border-b"
        title={
          <div className="-mb-3 w-full pb-6">
            <h3>Set Reminder</h3>
            <p className="text-gray-600">
              Notify you and / or others via email about this asset.
            </p>
          </div>
        }
      >
        <Form
          ref={zo.ref}
          method="POST"
          encType="multipart/form-data"
          className="grid grid-cols-1 divide-x md:grid-cols-2"
          action={action}
        >
          <div className="px-6 py-4">
            <input
              type="hidden"
              name="intent"
              value={isEdit ? "edit-reminder" : "set-reminder"}
            />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            {isEdit ? (
              <input type="hidden" name="id" value={reminder.id} />
            ) : (
              false
            )}

            <Input
              ref={nameInputRef}
              defaultValue={reminder?.name ?? ""}
              name={zo.fields.name()}
              error={
                validationErrors?.name?.message || zo.errors.name()?.message
              }
              label="Name"
              disabled={disabled}
              required
              placeholder="Enter name of reminder"
              className="mb-4"
            />

            <div className="mb-4">
              <Input
                defaultValue={reminder?.message ?? ""}
                name={zo.fields.message()}
                error={
                  validationErrors?.message?.message ||
                  zo.errors.message()?.message
                }
                label="Message"
                disabled={disabled}
                required
                placeholder="Enter description..."
                inputType="textarea"
                className="mb-2"
              />
              <p className="text-gray-500">
                This will show in the reminder mail that gets sent to selected
                team member(s). Curious about the reminder mail?{" "}
                <Button
                  variant="link"
                  to="https://www.shelf.nu/knowledge-base/asset-reminders"
                  target="_blank"
                >
                  See a sample
                </Button>
                .
              </p>
            </div>

            <div className="mb-4">
              <Input
                defaultValue={
                  reminder?.alertDateTime
                    ? dateForDateTimeInputValue(
                        new Date(reminder.alertDateTime)
                      )
                    : undefined
                }
                type="datetime-local"
                name={zo.fields.alertDateTime()}
                error={
                  validationErrors?.alertDateTime?.message ||
                  zo.errors.alertDateTime()?.message
                }
                label="Reminder Date"
                disabled={disabled}
                required
                placeholder="Enter description..."
                className="mb-2"
              />
              <p className="text-gray-500">
                We will send the reminder at this date/time.
              </p>
            </div>

            <div className="mb-4">
              <label
                htmlFor="reminder-repeat-trigger"
                className={`mb-[6px] block text-sm font-medium ${
                  canUseRecurringReminders ? "text-gray-700" : "text-gray-500"
                }`}
              >
                Repeat
              </label>
              {canUseRecurringReminders ? (
                <Select
                  name={zo.fields.repeat()}
                  value={repeat}
                  onValueChange={(value) =>
                    setRepeat(value as ReminderRepeatValue)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger id="reminder-repeat-trigger">
                    <SelectValue placeholder="Never" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    {Object.entries(REMINDER_REPEAT_PRESETS).map(
                      ([value, preset]) => (
                        <SelectItem key={value} value={value}>
                          {preset.label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <>
                  {/* why hidden inputs: a disabled control submits nothing —
                      carry the STORED cadence through so plain edits by
                      downgraded workspaces neither throw nor strip it */}
                  <input type="hidden" name="repeat" value={initialRepeat} />
                  {endsAtDefault ? (
                    <input type="hidden" name="endsAt" value={endsAtDefault} />
                  ) : null}
                  <Select value={initialRepeat} disabled>
                    <SelectTrigger id="reminder-repeat-trigger">
                      <SelectValue placeholder="Never" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Never</SelectItem>
                      {Object.entries(REMINDER_REPEAT_PRESETS).map(
                        ([value, preset]) => (
                          <SelectItem key={value} value={value}>
                            {preset.label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </>
              )}
              {canUseRecurringReminders ? (
                <p className="mt-1 text-gray-500">
                  Automatically send this reminder again on a schedule.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-gray-500">
                    Recurring reminders are a premium feature.{" "}
                    <Button
                      variant="link"
                      className="inline text-sm"
                      to="/account-details/subscription"
                    >
                      Upgrade your plan
                    </Button>{" "}
                    to send reminders on a schedule.
                  </p>
                  {/* why: the Ends-on input doesn't render in the locked
                      state, but its stored value still round-trips through
                      hidden inputs and can fail validation (e.g. moving the
                      reminder date past the series' end date) — surface that
                      error here or the submit blocks with no visible cause */}
                  {validationErrors?.endsAt?.message ||
                  zo.errors.endsAt()?.message ? (
                    <p className="mt-1 text-sm text-error-500">
                      {validationErrors?.endsAt?.message ||
                        zo.errors.endsAt()?.message}{" "}
                      (this reminder's end date is fixed on your current plan)
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {canUseRecurringReminders && repeat !== "never" ? (
              <div>
                <Input
                  defaultValue={endsAtDefault}
                  type="date"
                  name={zo.fields.endsAt()}
                  error={
                    validationErrors?.endsAt?.message ||
                    zo.errors.endsAt()?.message
                  }
                  label="Ends on (optional)"
                  disabled={disabled}
                  className="mb-2"
                />
                <p className="text-gray-500">
                  Leave empty to repeat until the reminder is deleted.
                </p>
              </div>
            ) : null}
          </div>
          <div>
            <Separator className="md:hidden" />
            <p className="border-b p-3 font-medium">Select team member(s)</p>
            <TeamMembersSelector
              defaultValues={reminder?.teamMembers}
              error={
                validationErrors?.teamMembers?.message ||
                zo.errors.teamMembers()?.message
              }
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t p-4 md:col-span-2">
            <Button
              type="button"
              role="button"
              variant="secondary"
              disabled={disabled}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button role="button" type="submit" disabled={disabled}>
              Confirm
            </Button>
          </div>
        </Form>
      </Dialog>
    </DialogPortal>
  );
}
