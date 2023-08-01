import type { User } from "@prisma/client";
import { Form } from "@remix-run/react";
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
import { TrashIcon } from "../icons";

export const DeleteUser = ({
  user,
}: {
  user: {
    id: User["id"];
    firstName: User["firstName"];
    lastName: User["lastName"];
  };
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button
        variant="secondary"
        data-test-id="deleteUserButton"
        className="justify-start px-6 py-3 text-sm font-semibold text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
        width="full"
      >
        Delete
      </Button>
    </AlertDialogTrigger>

    <AlertDialogContent>
      <AlertDialogHeader>
        <div className="mx-auto md:m-0">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
            <TrashIcon />
          </span>
        </div>
        <AlertDialogTitle>
          Delete {user.firstName} {user.lastName}
        </AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to delete this user? This action cannot be
          undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <div className="flex justify-center gap-2">
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>

          <Form method="delete">
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              data-test-id="confirmdeleteUserButton"
            >
              Delete
            </Button>
          </Form>
        </div>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
