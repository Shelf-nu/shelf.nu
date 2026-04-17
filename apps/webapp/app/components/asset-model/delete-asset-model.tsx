import type { ReactNode } from "react";
import type { AssetModel } from "@prisma/client";
import { useFetcher } from "react-router";
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
import { TrashIcon } from "../icons/library";

export const DeleteAssetModel = ({
  assetModel,
  trigger,
}: {
  assetModel: Pick<AssetModel, "name" | "id"> & {
    _count?: { assets: number };
  };
  trigger?: ReactNode;
}) => {
  const assetCount = assetModel._count?.assets ?? 0;
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);

  const defaultTrigger = (
    <Button
      disabled={disabled}
      variant="secondary"
      size="sm"
      type="button"
      className="text-[12px]"
      icon={"trash"}
      title={"Delete"}
    />
  );

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {trigger ? trigger : defaultTrigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
            <TrashIcon />
          </span>
          <AlertDialogTitle>Delete {assetModel.name}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this asset model? This action cannot
            be undone.
          </AlertDialogDescription>
          {assetCount > 0 ? (
            <div className="rounded-md border border-warning-200 bg-warning-25 p-3 text-sm text-warning-700">
              <strong>Warning:</strong> This model has {assetCount} asset
              {assetCount === 1 ? "" : "s"} assigned to it. Deleting it will
              unassign those assets.
            </div>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </AlertDialogCancel>
          <fetcher.Form method="delete" action="/settings/asset-models">
            <input type="hidden" name="id" value={assetModel.id} />
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              disabled={disabled}
            >
              {disabled ? "Deleting..." : "Delete"}
            </Button>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
