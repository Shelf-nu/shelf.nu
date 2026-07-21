import { useEffect, useRef } from "react";
import { Form, useNavigation, useLocation, useActionData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import { useSearchParams } from "~/hooks/search-params";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import TeamMembersSelector from "./team-members-selector";
import { Dialog, DialogPortal } from "../layout/dialog";

export const setReminderSchema = z.object({
  name: z.string().min(1, "Please enter name."),
  message: z.string().min(1, "Please enter message."),
  alertDateTime: z.coerce
    .date()
    .min(new Date(), "Please select a date in the future"),
  teamMembers: z
    .array(z.string())
    .min(1, "Please select at least one team member"),
  redirectTo: z.string().optional(),
});

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

  const pathname = useLocation().pathname;
  const [searchParams, setSearchParams] = useSearchParams();

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
      const success = searchParams.get("success");

      if (success !== "true") {
        // Re-arm the latch once the param is gone (or was never set) so a
        // *subsequent* success (e.g. creating another reminder) still closes
        // the dialog and strips the param.
        successHandledRef.current = false;
        return;
      }

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
    [onClose, searchParams, setSearchParams]
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
