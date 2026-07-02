/**
 * Recurrence controls for the set/edit reminder dialog: the Repeat select
 * (locked with an upgrade nudge when the workspace tier lacks recurrence)
 * and the optional "Ends on" date input.
 *
 * Extracted from SetOrEditReminderDialog to keep the dialog component lean;
 * all form state (zorm field names, error fallbacks) is threaded in as props.
 *
 * @see {@link file://./set-or-edit-reminder-dialog.tsx}
 */
import Input from "~/components/forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import { Button } from "~/components/shared/button";
import {
  REMINDER_REPEAT_PRESETS,
  type ReminderRepeatValue,
} from "~/modules/asset-reminder/recurrence";

type ReminderRecurrenceFieldsProps = {
  /** Whether the workspace tier includes recurring reminders. */
  canUseRecurringReminders: boolean;
  /** Form-submission disabled state (useDisabled). */
  disabled: boolean;
  /** Controlled Repeat selection. */
  repeat: ReminderRepeatValue;
  onRepeatChange: (value: ReminderRepeatValue) => void;
  /** The stored cadence, round-tripped via hidden inputs when locked. */
  initialRepeat: ReminderRepeatValue;
  /** Stored end date (yyyy-MM-dd in the series' own timezone), if any. */
  endsAtDefault?: string;
  /** zorm field names. */
  repeatFieldName: string;
  endsAtFieldName: string;
  /** Combined client/server error message for the endsAt field, if any. */
  endsAtError?: string;
};

function RepeatOptions() {
  return (
    <SelectContent>
      <SelectItem value="never">Never</SelectItem>
      {Object.entries(REMINDER_REPEAT_PRESETS).map(([value, preset]) => (
        <SelectItem key={value} value={value}>
          {preset.label}
        </SelectItem>
      ))}
    </SelectContent>
  );
}

export default function ReminderRecurrenceFields({
  canUseRecurringReminders,
  disabled,
  repeat,
  onRepeatChange,
  initialRepeat,
  endsAtDefault,
  repeatFieldName,
  endsAtFieldName,
  endsAtError,
}: ReminderRecurrenceFieldsProps) {
  return (
    <>
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
            name={repeatFieldName}
            value={repeat}
            onValueChange={(value) =>
              onRepeatChange(value as ReminderRepeatValue)
            }
            disabled={disabled}
          >
            <SelectTrigger id="reminder-repeat-trigger">
              <SelectValue placeholder="Never" />
            </SelectTrigger>
            <RepeatOptions />
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
              <RepeatOptions />
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
            {/* why: the Ends-on input doesn't render in the locked state,
                but its stored value still round-trips through hidden inputs
                and can fail validation (e.g. moving the reminder date past
                the series' end date) — surface that error here or the
                submit blocks with no visible cause. role="alert" because
                there is no associated rendered input for screen readers. */}
            {endsAtError ? (
              <p role="alert" className="mt-1 text-sm text-error-500">
                {endsAtError} (this reminder's end date is fixed on your current
                plan)
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
            name={endsAtFieldName}
            error={endsAtError}
            label="Ends on (optional)"
            disabled={disabled}
            className="mb-2"
          />
          <p className="text-gray-500">
            Leave empty to repeat until the reminder is deleted.
          </p>
        </div>
      ) : null}
    </>
  );
}
