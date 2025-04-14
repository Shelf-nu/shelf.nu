import { forwardRef } from "react";
import type { Group } from "@prisma/client";
import { useNavigation } from "@remix-run/react";
import { TrashIcon } from "lucide-react";
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
import { isFormProcessing } from "~/utils/form";
import { Form } from "../custom-form";
import { Button } from "../shared/button";

type DeleteGroupAlertProps = {
  group: Pick<Group, "id" | "name">;
};

const DeleteGroupAlert = forwardRef<HTMLButtonElement, DeleteGroupAlertProps>(
  function ({ group }, ref) {
    const navigation = useNavigation();
    const disabled = isFormProcessing(navigation.state);

    return (
      <AlertDialog>
        <AlertDialogTrigger
          ref={ref}
          className="flex w-full items-center gap-2 rounded px-4 py-3 font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-700"
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

            <AlertDialogTitle>Delete {group.name}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this group? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <Form method="POST">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="groupId" value={group.id} />

              <Button
                disabled={disabled}
                className="border-error-600 bg-error-600 hover:border-error-800 hover:!bg-error-800"
              >
                Delete
              </Button>
            </Form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);
DeleteGroupAlert.displayName = "DeleteGroupAlert";
export default DeleteGroupAlert;
