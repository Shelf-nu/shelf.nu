import { useEffect, useState } from "react";
import { useActionData } from "react-router";
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
import { useDisabled } from "~/hooks/use-disabled";
import type { action } from "~/routes/_layout+/account-details.general";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

export const DeleteUser = () => {
  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (actionData && !actionData?.error && actionData.success) {
      setOpen(false);
    }
  }, [actionData]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          data-test-id="deleteUserButton"
          variant="danger"
          className="mt-3"
        >
          Delete user
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <Form method="delete" className="">
          <AlertDialogHeader>
            <div className="mx-auto md:m-0">
              <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
                <TrashIcon />
              </span>
            </div>
            <AlertDialogTitle>
              Are you sure you want to delete this user?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This is a final delete and cannot be reverted. Deleting a user
              will also delete:
            </AlertDialogDescription>
            <ul className="list-inside list-disc">
              <li>All the user's data</li>
              <li>All user's workspaces</li>
            </ul>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-3">
            <div className="flex justify-center gap-2">
              <AlertDialogCancel asChild>
                <Button variant="secondary" disabled={disabled} type="button">
                  Cancel
                </Button>
              </AlertDialogCancel>

              <Button
                className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
                type="submit"
                data-test-id="confirmdeleteUserButton"
                disabled={disabled}
                name="intent"
                value="deleteUser"
              >
                Confirm
              </Button>
            </div>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
};
