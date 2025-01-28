import { forwardRef } from "react";
import type { Prisma } from "@prisma/client";
import { Form, useNavigation } from "@remix-run/react";
import { TrashIcon } from "lucide-react";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import type { ASSET_REMINDER_INCLUDE_FIELDS } from "~/modules/asset-reminder/fields";
import { isFormProcessing } from "~/utils/form";

type DeleteReminderProps = {
  reminder: Prisma.AssetReminderGetPayload<{
    include: typeof ASSET_REMINDER_INCLUDE_FIELDS;
  }>;
};

const DeleteReminder = forwardRef<HTMLButtonElement, DeleteReminderProps>(
  function ({ reminder }, ref) {
    const navigation = useNavigation();
    const disabled = isFormProcessing(navigation.state);

    return (
      <AlertDialog>
        <AlertDialogTrigger
          ref={ref}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-700"
        >
          <TrashIcon className="size-4" /> Delete
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mx-auto md:m-0">
              <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
                <TrashIcon />
              </span>
            </div>
            <AlertDialogTitle>Delete {reminder.name}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this reminder? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <div className="flex justify-center gap-2">
              <AlertDialogCancel disabled={disabled} asChild>
                <Button variant="secondary">Cancel</Button>
              </AlertDialogCancel>

              <Form method="delete">
                <input type="hidden" value={reminder.id} name="id" />
                <input type="hidden" value="delete-reminder" name="intent" />

                <Button
                  disabled={disabled}
                  className="border-error-600 bg-error-600 hover:border-error-800 hover:!bg-error-800"
                >
                  Delete
                </Button>
              </Form>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);

DeleteReminder.displayName = "DeleteReminder";
export default DeleteReminder;
