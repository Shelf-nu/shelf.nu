/**
 * Delete Asset Dialog
 *
 * Permanent delete of one asset, from the asset page's actions menu and the
 * assets index row actions. The user types the asset's title before Delete is
 * enabled (see {@link TypeToConfirm}); the copy says what the delete takes with
 * it, because nothing can bring the asset back. The copy is shared with the
 * companion's delete sheet through `@shelf/labels`.
 *
 * @see {@link file://../../routes/_layout+/assets.$assetId.tsx} - Action handler
 */
import type { ReactElement } from "react";
import { cloneElement, forwardRef } from "react";
import type { Asset } from "@prisma/client";
import { DELETE_CONSEQUENCE_LABELS } from "@shelf/labels";
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
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

type DeleteAssetProps = {
  asset: {
    id: Asset["id"];
    title: Asset["title"];
    mainImage: Asset["mainImage"];
  };
  trigger: ReactElement;
};

export const DeleteAsset = forwardRef<HTMLButtonElement, DeleteAssetProps>(
  function ({ asset, trigger }, ref) {
    const disabled = useDisabled();
    const confirm = useTypeToConfirm(asset.title);

    return (
      <AlertDialog
        onOpenChange={(open) => {
          // Each open starts empty: a name typed for an earlier attempt must
          // not leave the button armed.
          if (!open) confirm.reset();
        }}
      >
        <AlertDialogTrigger ref={ref} asChild>
          {cloneElement(trigger)}
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mx-auto md:m-0">
              <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
                <TrashIcon />
              </span>
            </div>
            <AlertDialogTitle>Delete {asset.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {DELETE_CONSEQUENCE_LABELS.ASSET}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <TypeToConfirm
            expected={asset.title}
            value={confirm.value}
            onChange={confirm.setValue}
            disabled={disabled}
          />

          <AlertDialogFooter>
            <div className="flex justify-center gap-2">
              <AlertDialogCancel asChild>
                <Button type="button" variant="secondary" disabled={disabled}>
                  Cancel
                </Button>
              </AlertDialogCancel>

              <Form method="delete" action={`/assets/${asset.id}`}>
                {asset.mainImage && (
                  <input
                    type="hidden"
                    value={asset.mainImage}
                    name="mainImageUrl"
                  />
                )}
                <input type="hidden" value="delete" name="intent" />
                <Button
                  className="border-error-600 bg-error-600 hover:border-error-800 hover:!bg-error-800"
                  type="submit"
                  data-test-id="confirmdeleteAssetButton"
                  disabled={disabled || !confirm.isConfirmed}
                >
                  {disabled ? "Deleting..." : "Delete"}
                </Button>
              </Form>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);

DeleteAsset.displayName = "DeleteAsset";
