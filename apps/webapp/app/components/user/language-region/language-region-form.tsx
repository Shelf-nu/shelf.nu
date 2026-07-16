/**
 * LanguageRegionForm
 *
 * Account-settings Card letting a user set their four formatting preferences
 * (date format, time format, week start, time zone). Selections are lifted
 * into local state so a live "Dates will look like…" preview — driven by the
 * pure formatDate(new Date(), livePrefs) — updates as the user changes fields.
 * Submits under the `updateFormatPrefs` intent; the four selectors ride the
 * <Form> via their hidden inputs.
 *
 * Values are always concrete — there is no "Automatic" option. A user whose
 * DB field is still null sees the hint-detected value (via useFormatPrefs) as
 * the initial selection.
 *
 * @see {@link file://../../../routes/_layout+/account-details.general.tsx}
 * @see {@link file://../../../utils/date-format.ts} formatDate
 */
import { useState } from "react";

import type {
  DateFormatPreference,
  TimeFormatPreference,
  WeekStartPreference,
} from "@prisma/client";
import {
  DateFormatPreference as DateFormatPreferenceEnum,
  TimeFormatPreference as TimeFormatPreferenceEnum,
  WeekStartPreference as WeekStartPreferenceEnum,
} from "@prisma/client";
import { useActionData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import FormRow from "~/components/forms/form-row";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { useDisabled } from "~/hooks/use-disabled";
import { useFormatPrefs } from "~/hooks/use-format-prefs";
import type { getUserWithContact } from "~/modules/user/service.server";
import type { UserPageActionData } from "~/routes/_layout+/account-details.general";
import { formatDate, isValidTimeZone } from "~/utils/date-format";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { getValidationErrors } from "~/utils/http";
import { DateFormatSelect } from "./date-format-select";
import { TimeFormatSelect } from "./time-format-select";
import { TimezoneSelect } from "./timezone-select";
import { WeekStartSelect } from "./week-start-select";

/**
 * Server-and-client schema for the format-preference form. All four fields
 * are required + concrete (enum-validated; timezone must be a real IANA name).
 */
export const FormatPrefsFormSchema = z.object({
  dateFormat: z.nativeEnum(DateFormatPreferenceEnum),
  timeFormat: z.nativeEnum(TimeFormatPreferenceEnum),
  weekStart: z.nativeEnum(WeekStartPreferenceEnum),
  timeZone: z
    .string()
    .min(1, "Time zone is required")
    .refine(isValidTimeZone, "Invalid time zone"),
});

/** Maps the WeekStartPreference enum to react-day-picker's weekStartsOn. */
const WEEK_START_TO_DAY: Record<WeekStartPreference, 0 | 1 | 6> = {
  MONDAY: 1,
  SUNDAY: 0,
  SATURDAY: 6,
};

/** Inverse of WEEK_START_TO_DAY — resolves a default enum from resolved prefs. */
const DAY_TO_WEEK_START: Record<0 | 1 | 6, WeekStartPreference> = {
  0: "SUNDAY",
  1: "MONDAY",
  6: "SATURDAY",
};

/**
 * Language & region settings Card.
 *
 * @param props.user - The current user (from getUserWithContact); its stored
 *   preferences seed the initial selection, falling back to hint-detected
 *   values for null fields.
 * @returns The language & region settings card
 */
export function LanguageRegionForm({
  user,
}: {
  user: ReturnType<typeof getUserWithContact>;
}) {
  const zo = useZorm("LanguageRegionForm", FormatPrefsFormSchema);
  const data = useActionData<UserPageActionData>();
  const disabled = useDisabled();

  // Resolved prefs (stored value → hint → hardcoded default) supply the
  // fallback for any DB field still null. Concrete values only.
  const resolved = useFormatPrefs();

  const validationErrors = getValidationErrors<typeof FormatPrefsFormSchema>(
    data?.error
  );

  // Lazy-initialized local selection. After mount these are user-controlled
  // and drive the live preview; they do NOT re-sync from props.
  const [dateFormat, setDateFormat] = useState<DateFormatPreference>(
    () => user?.dateFormat ?? resolved.dateFormat
  );
  const [timeFormat, setTimeFormat] = useState<TimeFormatPreference>(
    () => user?.timeFormat ?? resolved.timeFormat
  );
  const [weekStart, setWeekStart] = useState<WeekStartPreference>(
    () => user?.weekStart ?? DAY_TO_WEEK_START[resolved.weekStartsOn]
  );
  const [timeZone, setTimeZone] = useState<string>(
    () => user?.timeZone ?? resolved.timeZone
  );

  // Build concrete resolved prefs from the live selection for the preview.
  const livePrefs: ResolvedFormatPrefs = {
    dateFormat,
    timeFormat,
    weekStartsOn: WEEK_START_TO_DAY[weekStart],
    timeZone,
  };
  const preview = formatDate(new Date(), livePrefs, { includeTime: true });

  return (
    <Card className="my-0">
      <div className="mb-6">
        <h3 className="text-text-lg font-semibold">Language &amp; region</h3>
        <p className="text-sm text-gray-600">
          Choose how dates, times, and calendars appear for your account.
        </p>
      </div>
      <Form method="post" ref={zo.ref} replace>
        <FormRow
          rowLabel="Date format"
          className="border-b-0 border-t"
          required={false}
        >
          <DateFormatSelect
            name={zo.fields.dateFormat()}
            value={dateFormat}
            onChange={setDateFormat}
          />
          {validationErrors?.dateFormat?.message ? (
            <p className="text-sm text-error-500">
              {validationErrors.dateFormat.message}
            </p>
          ) : null}
        </FormRow>

        <FormRow rowLabel="Time format" required={false}>
          <TimeFormatSelect
            name={zo.fields.timeFormat()}
            value={timeFormat}
            onChange={setTimeFormat}
          />
          {validationErrors?.timeFormat?.message ? (
            <p className="text-sm text-error-500">
              {validationErrors.timeFormat.message}
            </p>
          ) : null}
        </FormRow>

        <FormRow rowLabel="Week starts on" required={false}>
          <WeekStartSelect
            name={zo.fields.weekStart()}
            value={weekStart}
            onChange={setWeekStart}
          />
          {validationErrors?.weekStart?.message ? (
            <p className="text-sm text-error-500">
              {validationErrors.weekStart.message}
            </p>
          ) : null}
        </FormRow>

        <FormRow rowLabel="Time zone" required={false}>
          <TimezoneSelect
            name={zo.fields.timeZone()}
            value={timeZone}
            onChange={setTimeZone}
          />
          {validationErrors?.timeZone?.message ||
          zo.errors.timeZone()?.message ? (
            <p className="text-sm text-error-500">
              {validationErrors?.timeZone?.message ||
                zo.errors.timeZone()?.message}
            </p>
          ) : null}
        </FormRow>

        <div
          className="mt-2 flex items-center gap-2 text-xs text-gray-500"
          aria-live="polite"
        >
          <span>Dates will look like:</span>
          <span className="font-medium text-gray-700">{preview}</span>
        </div>

        <div className="mt-4 text-right">
          <input type="hidden" name="type" value="updateFormatPrefs" />
          <Button
            disabled={disabled}
            type="submit"
            name="intent"
            value="updateFormatPrefs"
          >
            {disabled ? "Saving..." : "Save"}
          </Button>
        </div>
      </Form>
    </Card>
  );
}
