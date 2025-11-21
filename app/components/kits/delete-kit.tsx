import { cloneElement } from "react";
import type { Kit } from "@prisma/client";
import { useNavigation } from "react-router";
import { isFormProcessing } from "~/utils/form";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";

type DeleteKitProps = {
  kit: Pick<Kit, "id" | "name" | "image">;
  trigger?: React.ReactElement;
};

export default function DeleteKit({ kit, trigger }: DeleteKitProps) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {trigger ? (
          cloneElement(trigger)
        ) : (
          <Button
            variant="link"
            icon="trash"
            className="justify-start rounded-sm px-4 py-3 text-sm font-semibold text-gray-700 outline-none  hover:bg-slate-100 hover:text-gray-700"
            width="full"
          >
            Delete
          </Button>
        )}
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <TrashIcon />
            </span>
          </div>
          <AlertDialogTitle>Delete {kit.name}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this kit? This action cannot be
            undone. Deleting a kit will not delete the assets. If the kit is
            checked out, assets will be made available again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <Form method="delete" action={`/kits/${kit.id}`}>
              {kit.image && (
                <input type="hidden" value={kit.image} name="image" />
              )}
              <input type="hidden" value="delete" name="intent" />
              <Button
                className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
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
}
