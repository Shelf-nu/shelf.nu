/**
 * Delete User Dialog (admin dashboard)
 *
 * Shelf staff close a user's account from `/admin-dashboard/:userId`. The
 * admin types the user's email before Confirm is enabled (see
 * {@link TypeToConfirm}), and the copy says what `softDeleteUser` does: the
 * account is closed and anonymised, records in workspaces the user is a member
 * of move to each workspace's owner, and workspaces the user owns are kept.
 *
 * @see {@link file://../../routes/_layout+/admin-dashboard+/$userId.tsx} - Action handler
 * @see {@link file://../../modules/user/service.server.ts} softDeleteUser
 */
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
import {
  TypeToConfirm,
  useTypeToConfirm,
} from "~/components/shared/type-to-confirm";
import { useDisabled } from "~/hooks/use-disabled";
import type { action } from "~/routes/_layout+/account-details.general";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

/**
 * @param props.email - The account's email, which the admin types to confirm
 */
export const DeleteUser = ({ email }: { email: string }) => {
  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();
  const [open, setOpen] = useState(false);
  const confirm = useTypeToConfirm(email);
  const { reset } = confirm;

  useEffect(() => {
    if (actionData && !actionData?.error && actionData.success) {
      setOpen(false);
    }
  }, [actionData]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Each open starts empty, so an earlier attempt never arms the button.
        if (!nextOpen) reset();
        setOpen(nextOpen);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
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
              This closes the account for good and cannot be reverted:
            </AlertDialogDescription>
            <ul className="list-inside list-disc text-sm text-gray-600">
              <li>
                They can no longer sign in. Their name shows as "Deleted User",
                and their contact details and profile picture are removed.
              </li>
              <li>
                In workspaces where they are a member, their assets, bookings,
                locations and other records move to the workspace owner, and
                their access is removed.
              </li>
              <li>Workspaces they own are not deleted.</li>
            </ul>
          </AlertDialogHeader>

          <div className="mt-3">
            <TypeToConfirm
              expected={email}
              value={confirm.value}
              onChange={confirm.setValue}
              disabled={disabled}
            />
          </div>

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
                disabled={disabled || !confirm.isConfirmed}
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
