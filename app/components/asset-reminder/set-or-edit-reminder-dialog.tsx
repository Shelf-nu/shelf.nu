import { useEffect } from "react";
import { Form, useNavigation } from "@remix-run/react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { isFormProcessing } from "~/utils/form";
import TeamMembersSelector from "./team-members-selector";
import { Dialog, DialogPortal } from "../layout/dialog";

export const setReminderSchema = z.object({
  name: z.string().min(1, "Please enter name."),
  message: z.string().min(1, "Please enter message."),
  alertDateTime: z.coerce.date().min(new Date()),
  teamMembers: z
    .array(z.string())
    .min(1, "Please select at least one team member"),
  redirectTo: z.string().optional(),
});

type SetOrEditReminderDialogProps = {
  open: boolean;
  onClose: () => void;
  reminder?: z.infer<typeof setReminderSchema> & { id: string };
};

export default function SetOrEditReminderDialog({
  open,
  onClose,
  reminder,
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

  const isEdit = !!reminder;

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
              defaultValue={reminder?.name ?? ""}
              name={zo.fields.name()}
              error={zo.errors.name()?.message}
              label="Name"
              disabled={disabled}
              autoFocus
              required
              placeholder="Enter name of reminder"
              className="mb-4"
            />

            <div className="mb-4">
              <Input
                defaultValue={reminder?.message ?? ""}
                name={zo.fields.message()}
                error={zo.errors.message()?.message}
                label="Message"
                disabled={disabled}
                autoFocus
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
                error={zo.errors.alertDateTime()?.message}
                label="Reminder Date"
                disabled={disabled}
                autoFocus
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
              error={zo.errors.teamMembers()?.message}
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t p-4 md:col-span-2">
            <Button
              role="button"
              variant="secondary"
              disabled={disabled}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button role="button" disabled={disabled}>
              Confirm
            </Button>
          </div>
        </Form>
      </Dialog>
    </DialogPortal>
  );
}
