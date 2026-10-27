/**
 * Recurrence controls for the set/edit reminder dialog: the Repeat dropdown
 * (limited, with an upgrade nudge, when the workspace tier lacks recurrence)
 * and the optional "Ends on" date input.
 *
 * Extracted from SetOrEditReminderDialog to keep the dialog component lean;
 * all form state (zorm field names, error fallbacks) is threaded in as props.
 *
 * @see {@link file://./set-or-edit-reminder-dialog.tsx}
 */
import { Button } from "~/components/shared/button";
import { DateTimePicker } from "~/components/shared/date-time-picker";
import { EnumPreferenceSelect } from "~/components/user/language-region/enum-preference-select";
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

/** One Repeat option: the preset label plus a line on when it sends. */
type RepeatOption = {
  value: ReminderRepeatValue;
  label: string;
  description: string;
};

/** Says when each cadence sends, under its label in the Repeat list. */
const REPEAT_DESCRIPTIONS: Record<ReminderRepeatValue, string> = {
  never: "Send this reminder once",
  daily: "Every day at the reminder's time",
  weekly: "Every week on the same weekday",
  biweekly: "Every other week on the same weekday",
  monthly: "Every month on the same day",
  quarterly: "Every 3 months on the same day",
  semiannually: "Every 6 months on the same day",
  yearly: "Every year on the same date",
};

/** Builds the Repeat option for one cadence. */
function repeatOption(value: ReminderRepeatValue): RepeatOption {
  return {
    value,
    label: value === "never" ? "Never" : REMINDER_REPEAT_PRESETS[value].label,
    description: REPEAT_DESCRIPTIONS[value],
  };
}

/** Never plus every preset, in the order they are offered. */
const ALL_REPEAT_OPTIONS: RepeatOption[] = [
  repeatOption("never"),
  ...(Object.keys(REMINDER_REPEAT_PRESETS) as ReminderRepeatValue[]).map(
    repeatOption
  ),
];

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
  /**
   * Without the plan, only "Never" and the stored cadence are offered; a
   * one-time reminder has nothing to choose, so the control locks.
   */
  const repeatOptions = canUseRecurringReminders
    ? ALL_REPEAT_OPTIONS
    : initialRepeat === "never"
    ? [repeatOption("never")]
    : [repeatOption("never"), repeatOption(initialRepeat)];
  const isLocked = !canUseRecurringReminders && initialRepeat === "never";

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
        <EnumPreferenceSelect
          id="reminder-repeat-trigger"
          name={repeatFieldName}
          value={repeat}
          onChange={onRepeatChange}
          options={repeatOptions}
          ariaLabel="Repeat"
          disabled={disabled || isLocked}
        />
        {/* A locked plan can keep the stored cadence or turn it off, never
            pick a new one. The stored end date rides along in a hidden input
            while the cadence is kept, so a plain edit leaves the series
            unchanged. */}
        {!canUseRecurringReminders && repeat !== "never" && endsAtDefault ? (
          <input type="hidden" name={endsAtFieldName} value={endsAtDefault} />
        ) : null}
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
