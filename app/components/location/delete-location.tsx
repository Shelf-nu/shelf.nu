import type { Location } from "@prisma/client";
import { useNavigation } from "@remix-run/react";
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
import { isFormProcessing } from "~/utils/form";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

export const DeleteLocation = ({
  location,
}: {
  location: {
    name: Location["name"];
    childCount?: number;
  };
}) => {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="link"
          data-test-id="deleteAssetButton"
          icon="trash"
          className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700"
          width="full"
        >
          Delete
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <TrashIcon />
            </span>
          </div>
          <AlertDialogTitle>Delete {location.name}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this Location? This action cannot be
            undone.
          </AlertDialogDescription>
          {location.childCount && location.childCount > 0 ? (
            <div className="rounded border border-warning-200 bg-warning-50 p-3 text-sm text-warning-900">
              This location has <strong>{location.childCount}</strong> child
              {location.childCount > 1 ? " locations" : " location"}. They will
              move to the root level if you delete this location.
            </div>
          ) : null}
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
                data-test-id="confirmdeleteLocationButton"
                disabled={disabled}
              >
                Delete
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
