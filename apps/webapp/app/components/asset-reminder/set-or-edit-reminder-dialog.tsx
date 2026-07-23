import { useEffect, useMemo, useRef } from "react";
import { DateTime } from "luxon";
import { Form, useNavigation, useLocation, useActionData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { DateTimePicker } from "~/components/shared/date-time-picker";
import { Separator } from "~/components/shared/separator";
import { useSearchParams } from "~/hooks/search-params";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useFormatPrefs } from "~/hooks/use-format-prefs";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { toIsoDateTimeToUserTimezone } from "~/utils/date-fns";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import TeamMembersSelector from "./team-members-selector";
import { Dialog, DialogPortal } from "../layout/dialog";

/** Options accepted by {@link createSetReminderSchema}. */
type CreateSetReminderSchemaOptions = {
  /**
   * The acting user's resolved IANA timezone preference — the SAME zone the
   * server parses submitted wall-clock times in and persists against. When
   * provided, the submitted `alertDateTime` wall-clock ("yyyy-MM-ddTHH:mm") is
   * interpreted in this zone (via Luxon) before the future-date check, so
   * client-side validation matches persistence exactly even when the browser
   * zone differs from the user's preference. When omitted (e.g. the shared
   * server constant that has no request context), the value is coerced in the
   * runtime's local zone as a best-effort fallback.
   */
  timeZone?: string;
};

/**
 * Builds the set/edit-reminder form schema.
 *
 * Two behaviours matter here:
 *
 * 1. The future-date cutoff for `alertDateTime` is evaluated **per validation**
 *    — the refinement reads a fresh `Date.now()` each time the schema runs — so
 *    a long-lived process never validates against a "now" frozen at module
 *    load. Because the refinement lives on the field (not the object), the
 *    return value stays a plain `ZodObject`, keeping `.extend(...)` usable by
 *    server callers.
 * 2. When `timeZone` is supplied, the submitted wall-clock string is
 *    interpreted in that timezone before the cutoff comparison, mirroring how
 *    the server persists it — so "future" is judged against the SAME instant
 *    that will be stored.
 *
 * @param options - Optional resolved format prefs (currently the timezone).
 * @returns A Zod object schema for the set/edit reminder form.
 */
export function createSetReminderSchema(
  options: CreateSetReminderSchemaOptions = {}
) {
  const { timeZone } = options;

  return z.object({
    name: z.string().min(1, "Please enter name."),
    message: z.string().min(1, "Please enter message."),
    alertDateTime: z
      .preprocess((value) => {
        // Interpret the submitted wall-clock in the acting user's timezone so
        // "future" is judged against the SAME instant that will be persisted.
        // Fall back to native coercion when no timezone is known or the value
        // doesn't match the expected format (Invalid Date then surfaces the
        // standard "Invalid date" error, preserving the existing UX).
        if (typeof value === "string" && timeZone) {
          const parsed = DateTime.fromFormat(value, DATE_TIME_FORMAT, {
            zone: timeZone,
          });
          if (parsed.isValid) {
            return parsed.toJSDate();
          }
        }
        return value;
      }, z.coerce.date())
      // Fresh `Date.now()` on every validation — never a module-load snapshot.
      .refine(
        (date) => date.getTime() > Date.now(),
        "Please select a date in the future"
      ),
    teamMembers: z
      .array(z.string())
      .min(1, "Please select at least one team member"),
    redirectTo: z.string().optional(),
  });
}

/**
 * Default reminder schema instance for server-side parsing where no request
 * timezone is threaded through the schema (e.g. `setReminderSchema.extend(...)`
 * in the edit action, or `parseData(formData, setReminderSchema)` in the create
 * action). Built via {@link createSetReminderSchema} so it inherits the
 * per-validation future-date cutoff. The server actions re-parse the wall-clock
 * in the user's resolved timezone with Luxon for persistence; client code
 * should prefer `createSetReminderSchema(timeZone)` so its future-date check is
 * timezone-accurate too.
 */
export const setReminderSchema = createSetReminderSchema();

type SetOrEditReminderDialogProps = {
  open: boolean;
  onClose: () => void;
  reminder?: z.infer<typeof setReminderSchema> & { id: string };
  action?: string;
};

export default function SetOrEditReminderDialog({
  open,
  onClose,
  reminder,
  action,
}: SetOrEditReminderDialogProps) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  /**
   * The acting user's resolved timezone preference — the SAME zone the server
   * parses submitted wall-clock times in and the UI displays dates in. Seeding
   * the datetime input from this (not the browser/runtime zone) keeps the
   * round-trip consistent when the two differ.
   */
  const { timeZone } = useFormatPrefs();

  const pathname = useLocation().pathname;
  const [searchParams, setSearchParams] = useSearchParams();

  const redirectTo = `${pathname}${
    searchParams.size > 0
      ? `?${searchParams.toString()}&success=true`
      : "?success=true"
  }`;

  /**
   * Client-side schema bound to the acting user's timezone so the future-date
   * check judges the submitted wall-clock in the SAME zone the server persists
   * it (see the reminder actions in `modules/asset-reminder/utils.server.ts`).
   * Memoized on `timeZone` for a stable identity across re-renders.
   */
  const schema = useMemo(
    () => createSetReminderSchema({ timeZone }),
    [timeZone]
  );

  const zo = useZorm("SetOrEditReminder", schema);

  const actionData = useActionData<DataOrErrorResponse>();
  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<typeof setReminderSchema>(
    actionData?.error
  );

  const isEdit = !!reminder;

  /** Ref for the first field so we can focus it on open without autoFocus. */
  const nameInputRef = useAutoFocus<HTMLInputElement>({ when: open });

  /**
   * One-shot latch guarding {@link handleOnSuccess} against re-firing while
   * the `success=true` param is still present but not yet stripped from the
   * committed URL.
   *
   * Root cause of the production incident this guards against: the reminder
   * form action redirects to `?...&success=true`. Handling that (closing the
   * dialog + stripping the param) is *itself* a second navigation, and until
   * that navigation commits, `searchParams` keeps reading `success=true` on
   * every intermediate re-render. Both `onClose` (an inline arrow in some
   * callers) and `setSearchParams` can also get a fresh identity every
   * render. Without a latch, any one of those re-renders re-runs this effect,
   * which calls `setSearchParams` again — aborting the in-flight strip
   * navigation before it commits — so `success` never clears and the effect
   * fires again on the next render: an infinite `reminders.data`
   * revalidation loop. This latch makes the effect body idempotent
   * regardless of dependency-identity churn (defense in depth on top of
   * stabilizing `onClose`/`setSearchParams` at the call sites).
   */
  const successHandledRef = useRef(false);

  useEffect(
    function handleOnSuccess() {
      const isSuccess = searchParams.get("success") === "true";

      if (!isSuccess) {
        // Re-arm the latch once the param is gone (or was never set) so a
        // *subsequent* success (e.g. creating another reminder) still closes
        // the dialog and strips the param.
        successHandledRef.current = false;
        return;
      }

      // Gate on `open`: the reminders table mounts ONE create dialog plus,
      // inside every row's `ActionsDropdown`, one (closed) edit dialog. All
      // of those instances observe the same `?success=true` param, so
      // without this gate every mounted instance — each with its own
      // independently-false latch — would call `setSearchParams` once,
      // producing N competing navigations/`.data` revalidations on an
      // N-row page. Only the dialog that is actually `open` (the one whose
      // submit produced this success) should react.
      if (!open) return;

      if (successHandledRef.current) {
        // Already handled this success signal — the strip navigation may
        // still be in flight; do not act again until `success` clears.
        return;
      }
      successHandledRef.current = true;

      onClose && onClose();

      // TODO(follow-up): migrate this form to `useFetcher` so success is
      // signalled via fetcher state instead of a `?success=true` redirect +
      // param-strip navigation. That would remove this whole class of loop,
      // but changing the form's action/redirect contract is out of scope for
      // this hotfix — it's shared with the global reminders page.
      setSearchParams(
        (prev) => {
          prev.delete("success");
          return prev;
        },
        { replace: true, preventScrollReset: true }
      );
    },
    [open, onClose, searchParams, setSearchParams]
  );

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

            <div>
              <DateTimePicker
                mode="datetime"
                defaultValue={
                  reminder?.alertDateTime
                    ? toIsoDateTimeToUserTimezone(
                        reminder.alertDateTime,
                        timeZone
                      ).slice(0, 16)
                    : undefined
                }
                name={zo.fields.alertDateTime()}
                error={
                  validationErrors?.alertDateTime?.message ||
                  zo.errors.alertDateTime()?.message
                }
                label="Reminder Date"
                disabled={disabled}
                required
                className="mb-2"
              />
              <p className="text-gray-500">
                We will send the reminder at this date/time.
              </p>
            </div>
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
