import { cloneElement } from "react";
import type { Asset } from "@prisma/client";
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
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

export const DeleteAsset = ({
  asset,
  trigger,
}: {
  asset: {
    title: Asset["title"];
    mainImage: Asset["mainImage"];
  };
  trigger: React.ReactElement;
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>{cloneElement(trigger)}</AlertDialogTrigger>

    <AlertDialogContent>
      <AlertDialogHeader>
        <div className="mx-auto md:m-0">
          <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
            <TrashIcon />
          </span>
        </div>
        <AlertDialogTitle>Delete {asset.title}</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to delete this asset? This action cannot be
          undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <div className="flex justify-center gap-2">
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>

          <Form method="delete">
            {asset.mainImage && (
              <input
                type="hidden"
                value={asset.mainImage}
                name="mainImageUrl"
              />
            )}
            <input type="hidden" value="delete" name="intent" />
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              data-test-id="confirmdeleteAssetButton"
            >
              Delete
            </Button>
          </Form>
        </div>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
