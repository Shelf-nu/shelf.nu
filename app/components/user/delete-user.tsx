import { useEffect, useState } from "react";
import { useActionData } from "@remix-run/react";
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
import { useUserData } from "~/hooks/use-user-data";
import type { action } from "~/routes/_layout+/account-details.general";
import { Form } from "../custom-form";
import Input from "../forms/input";
import { TrashIcon } from "../icons/library";

export const DeleteUser = () => {
  const disabled = useDisabled();
  const user = useUserData();
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
          Send delete request
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
              Are you sure you want to delete your account?
            </AlertDialogTitle>
            <AlertDialogDescription>
              In order to delete your account you need to send a request that
              will be fulfilled within the next 72 hours. Account deletion is
              final and cannot be undone.
            </AlertDialogDescription>

            <Input
              inputType="textarea"
              name="reason"
              label="Reason for deleting your account"
              required
            />
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-3">
            <div className="flex justify-center gap-2">
              <AlertDialogCancel asChild>
                <Button variant="secondary" disabled={disabled} type="button">
                  Cancel
                </Button>
              </AlertDialogCancel>

              <input type="hidden" name="email" value={user?.email} />

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
