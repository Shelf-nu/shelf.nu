/**
 * Delete Asset Model Dialog
 *
 * Permanent delete of one asset model from the asset models index. The user
 * types the model's name before Delete is enabled (see {@link TypeToConfirm}).
 * The copy names what the delete reaches beyond the model: its assets lose the
 * link, and booking reservations made by this model are removed with it.
 *
 * @see {@link file://../../routes/_layout+/settings.asset-models.tsx} - Action handler
 */
import type { ReactNode } from "react";
import { useId } from "react";
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
import {
  TypeToConfirm,
  useTypeToConfirm,
} from "~/components/shared/type-to-confirm";
import { useDisabled } from "~/hooks/use-disabled";
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
  const disabled = useDisabled(fetcher);
  const confirm = useTypeToConfirm(assetModel.name);
  // The field sits outside the form that submits; this links the two.
  const formId = useId();

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
    <AlertDialog
      onOpenChange={(open) => {
        // Each open starts empty, so an earlier attempt never arms the button.
        if (!open) confirm.reset();
      }}
    >
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
            This permanently deletes the asset model. Every booking reservation
            made by this model is removed with it. This cannot be undone.
          </AlertDialogDescription>
          {assetCount > 0 ? (
            <div className="rounded-md border border-warning-200 bg-warning-25 p-3 text-sm text-warning-700">
              <strong>Warning:</strong> This model has {assetCount} asset
              {assetCount === 1 ? "" : "s"} assigned to it. They are kept, but
              lose the model.
            </div>
          ) : null}
        </AlertDialogHeader>

        <TypeToConfirm
          form={formId}
          expected={assetModel.name}
          value={confirm.value}
          onChange={confirm.setValue}
          disabled={disabled}
        />

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="secondary" disabled={disabled}>
              Cancel
            </Button>
          </AlertDialogCancel>
          <fetcher.Form
            id={formId}
            method="delete"
            action="/settings/asset-models"
          >
            <input type="hidden" name="id" value={assetModel.id} />
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              disabled={disabled || !confirm.isConfirmed}
            >
              {disabled ? "Deleting..." : "Delete"}
            </Button>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
