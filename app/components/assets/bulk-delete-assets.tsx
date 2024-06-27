import { useEffect, useState } from "react";
import { Form, useActionData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectedBulkItemsAtom, setSelectedBulkItemsAtom } from "~/atoms/list";
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

export default function BulkDeleteAssets() {
  const [open, setOpen] = useState(false);

  const actionData = useActionData<{ success: boolean }>();

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const setSelectedAssets = useSetAtom(setSelectedBulkItemsAtom);

  useEffect(
    function updateStatesOnDeleteSuccess() {
      /** We have to close the AlertDialog and deselect all the selected items if the delete action was success */
      if (actionData?.success) {
        setOpen(false);
        setSelectedAssets([]);
      }
    },
    [actionData?.success, setSelectedAssets]
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger disabled={!selectedAssets.length} asChild>
        <Button
          variant="link"
          icon="trash"
          className="justify-start rounded-sm px-4 py-3 text-sm font-semibold text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
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
          <AlertDialogTitle>
            Delete {selectedAssets.length} assets
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete all {selectedAssets.length} assets?
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>

            <Form method="delete">
              {selectedAssets.map((assetId, i) => (
                <input
                  key={assetId}
                  type="hidden"
                  name={`assetIds[${i}]`}
                  value={assetId}
                />
              ))}

              <input type="hidden" value="bulk-delete" name="intent" />

              <Button className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800">
                Delete
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
