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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import { Button } from "~/components/shared/button";
import { DateTimePicker } from "~/components/shared/date-time-picker";
import {
  REMINDER_REPEAT_PRESETS,
  type ReminderRepeatValue,
} from "~/modules/asset-reminder/recurrence";

/** Props for {@link ReminderRecurrenceFields}. */
type ReminderRecurrenceFieldsProps = {
  /** Whether the workspace tier includes recurring reminders. */
  canUseRecurringReminders: boolean;
  /** Form-submission disabled state (useDisabled). */
  disabled: boolean;
  /** Controlled Repeat selection. */
  repeat: ReminderRepeatValue;
  onRepeatChange: (value: ReminderRepeatValue) => void;
  /** The stored cadence: the only repeating option offered when locked. */
  initialRepeat: ReminderRepeatValue;
  /** Stored end date (yyyy-MM-dd in the series' own timezone), if any. */
  endsAtDefault?: string;
  /** zorm field names. */
  repeatFieldName: string;
  endsAtFieldName: string;
  /** Combined client/server error message for the endsAt field, if any. */
  endsAtError?: string;
};

/** The shared option list (Never + the repeating presets) for both select states. */
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

/**
 * Renders the Repeat select and the optional "Ends on" date input for the
 * set/edit reminder dialog. When the workspace tier lacks recurring
 * reminders, the select offers only "Never" and the stored cadence, with an
 * upgrade nudge, so a downgraded workspace can keep or stop a series but not
 * start or change one.
 *
 * @param props - See {@link ReminderRecurrenceFieldsProps}.
 * @returns The recurrence form-fields fragment.
 */
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
        ) : initialRepeat === "never" ? (
          <>
            {/* why hidden input: a disabled control submits nothing */}
            <input type="hidden" name={repeatFieldName} value="never" />
            <Select value="never" disabled>
              <SelectTrigger id="reminder-repeat-trigger">
                <SelectValue placeholder="Never" />
              </SelectTrigger>
              <RepeatOptions />
            </Select>
          </>
        ) : (
          <>
            {/* A locked plan can keep the stored cadence or turn it off, never
                pick a new one. The stored end date rides along in a hidden
                input while the cadence is kept, so a plain edit leaves the
                series unchanged. */}
            {repeat !== "never" && endsAtDefault ? (
              <input
                type="hidden"
                name={endsAtFieldName}
                value={endsAtDefault}
              />
            ) : null}
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
              <SelectContent>
                <SelectItem value="never">Never</SelectItem>
                <SelectItem value={initialRepeat}>
                  {REMINDER_REPEAT_PRESETS[initialRepeat].label}
                </SelectItem>
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
            {/* why: the Ends-on input doesn't render in the locked state,
                but its stored value still round-trips through hidden inputs
                and can fail validation (e.g. moving the reminder date past
                the series' end date), surface that error here or the
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
          <DateTimePicker
            mode="date"
            defaultValue={endsAtDefault}
            name={endsAtFieldName}
            error={endsAtError}
            label="Ends on (optional)"
            disabled={disabled}
            clearable
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
