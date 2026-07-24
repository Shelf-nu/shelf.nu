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
import type { ReactNode } from "react";

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
 * One format-preference field: an always-present accessible label wrapping its
 * selector control, plus an assertive error region.
 *
 * `FormRow` renders its visible column label only at `lg` and up
 * (`hidden lg:block`), so below that breakpoint the selector triggers would
 * lose their field name entirely — both visually and in the accessibility tree.
 * This wrapper fixes both:
 *
 * - The label `<span>` is a visible block below `lg` (restoring the field name
 *   the `FormRow` column hides) and `sr-only` at `lg` and up (so it does not
 *   duplicate that visible column, while staying in the a11y tree at every
 *   breakpoint — `sr-only` clips rather than `display:none`).
 * - Because the `<label>` WRAPS the control, the underlying trigger button gets
 *   this field name as its accessible name at all breakpoints, without reaching
 *   into the shared selector components.
 * - The error message is a `role="alert"` live region so failed validation is
 *   announced when it appears.
 *
 * @param props.label - The field name (e.g. "Date format").
 * @param props.error - Validation message to surface/announce, if any.
 * @param props.children - The selector control for this field.
 * @returns The labeled field with its optional error region.
 */
function FormatPrefField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <>
      <label className="block w-full">
        <span className="mb-1 block text-text-sm font-medium text-gray-700 lg:sr-only">
          {label}
        </span>
        {children}
      </label>
      {error ? (
        <p role="alert" className="mt-1 w-full text-sm text-error-500">
          {error}
        </p>
      ) : null}
    </>
  );
}

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
  user: Awaited<ReturnType<typeof getUserWithContact>>;
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
          <FormatPrefField
            label="Date format"
            error={validationErrors?.dateFormat?.message}
          >
            <DateFormatSelect
              name={zo.fields.dateFormat()}
              value={dateFormat}
              onChange={setDateFormat}
            />
          </FormatPrefField>
        </FormRow>

        <FormRow rowLabel="Time format" required={false}>
          <FormatPrefField
            label="Time format"
            error={validationErrors?.timeFormat?.message}
          >
            <TimeFormatSelect
              name={zo.fields.timeFormat()}
              value={timeFormat}
              onChange={setTimeFormat}
            />
          </FormatPrefField>
        </FormRow>

        <FormRow rowLabel="Week starts on" required={false}>
          <FormatPrefField
            label="Week starts on"
            error={validationErrors?.weekStart?.message}
          >
            <WeekStartSelect
              name={zo.fields.weekStart()}
              value={weekStart}
              onChange={setWeekStart}
            />
          </FormatPrefField>
        </FormRow>

        <FormRow rowLabel="Time zone" required={false}>
          <FormatPrefField
            label="Time zone"
            error={
              validationErrors?.timeZone?.message ||
              zo.errors.timeZone()?.message
            }
          >
            <TimezoneSelect
              name={zo.fields.timeZone()}
              value={timeZone}
              onChange={setTimeZone}
            />
          </FormatPrefField>
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
