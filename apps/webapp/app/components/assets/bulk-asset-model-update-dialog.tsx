/**
 * Bulk Asset Model Update Dialog
 *
 * Lets a user group many existing assets into one AssetModel from the asset
 * index "Actions" menu, instead of opening each asset's edit form or
 * re-importing a CSV.
 *
 * Assign only. Ungrouping is its own menu item and dialog
 * ({@link file://./bulk-asset-model-remove-dialog.tsx}) so that this picker
 * contains nothing but real asset models: an in-list "remove" row reads as a
 * model called "Remove from asset model" to anyone who has not made one yet.
 * That also matches how the menu already treats tags and kits, which each have
 * a separate Remove item.
 *
 * Reads the selection from `selectedBulkItemsAtom` and posts to
 * `/api/assets/bulk-update-asset-model` via {@link BulkUpdateDialogContent},
 * which also forwards the active index filters so a cross-page "select all"
 * resolves server-side.
 *
 * @see {@link file://./../../routes/api+/assets.bulk-update-asset-model.ts} action
 * @see {@link file://./../../modules/asset/service.server.ts} `bulkUpdateAssetModel`
 * @see {@link file://./asset-model-form-row.tsx} the single-asset equivalent
 */
import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { isQuantityTracked } from "~/modules/asset/utils";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import DynamicSelect from "../dynamic-select/dynamic-select";
import InlineEntityCreationDialog from "../inline-entity-creation-dialog/inline-entity-creation-dialog";
import { Button } from "../shared/button";
import { WarningBox } from "../shared/warning-box";

/**
 * Wire format for `/api/assets/bulk-update-asset-model`, which serves BOTH the
 * assign dialog and {@link file://./bulk-asset-model-remove-dialog.tsx}.
 *
 * `assetModelId` is deliberately not `.min(1)`: an empty value is how the
 * remove dialog asks for an unlink. Keep it that way, or removal breaks.
 *
 * It lives here rather than in the route because a route file may only export
 * `loader`/`action` (see .claude/rules/no-server-module-in-route-client-exports),
 * and this is the same place the sibling bulk dialogs keep their schemas.
 */
export const BulkAssetModelActionSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  assetModelId: z.string(),
});

/**
 * What the assign form validates client-side. A model is required here: an
 * empty submit from THIS dialog would silently ungroup, which is the other
 * dialog's job, so it has to fail with a message instead.
 */
export const BulkAssetModelUpdateSchema = BulkAssetModelActionSchema.extend({
  assetModelId: z.string().min(1, "Please select an asset model"),
});

export default function BulkAssetModelUpdateDialog() {
  const { totalItems } = useLoaderData<AssetIndexLoaderData>();
  const zo = useZorm("BulkAssetModelUpdate", BulkAssetModelUpdateSchema);

  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const isSelectingAll = isSelectingAllItems(selectedItems);

  /**
   * The shared count atom counts array entries, and a cross-page "select all"
   * is stored as a single sentinel entry — so it would report the page size
   * while the action changed every filtered asset. Use the loader's total in
   * that case, the same way the bulk delete dialog does.
   */
  const totalSelected = isSelectingAll ? totalItems : selectedItems.length;

  /**
   * Asset models describe N distinguishable units of one template, so they
   * only apply to individually tracked assets, and `bulkUpdateAssetModel`
   * skips quantity-tracked ones. Warn before the user commits rather than
   * after.
   *
   * The gate is the current page's contents in both modes. Under select-all
   * the client holds only the current page plus a sentinel, so the copy drops
   * the number rather than stating one that understates the batch. Gating on
   * the page (instead of "always warn when selecting all") keeps the warning
   * out of workspaces that track nothing by quantity, where it would be noise
   * on every sweep. If a later page turns out to hold quantity-tracked assets,
   * the result toast still reports exactly how many were skipped.
   */
  const quantityTrackedCount = selectedItems.filter((item) =>
    isQuantityTracked(item)
  ).length;

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="asset-model"
      arrayFieldId="assetIds"
      title={`Group (${totalSelected}) assets into an asset model`}
      description="Pick the model these assets belong to. Their category, value and custody are not changed."
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div>
          {quantityTrackedCount > 0 ? (
            <div className="mb-4">
              <WarningBox>
                <span>
                  {isSelectingAll
                    ? "Any quantity-tracked assets in your selection will be skipped."
                    : `${quantityTrackedCount} quantity-tracked asset(s) in your selection will be skipped.`}{" "}
                  Asset models can only be linked to individually tracked
                  assets.
                </span>
              </WarningBox>
            </div>
          ) : null}

          <div className="relative z-50 mb-8">
            <DynamicSelect
              disabled={disabled}
              model={{ name: "assetModel", queryKey: "name" }}
              placeholder="Select asset model"
              initialDataKey="assetModels"
              countKey="totalAssetModels"
              fieldName="assetModelId"
              contentLabel="Asset models"
              closeOnSelect
              extraContent={({ onItemCreated, closePopover }) => (
                <InlineEntityCreationDialog
                  type="assetModel"
                  title="Create new asset model"
                  buttonLabel="Create new asset model"
                  onCreated={(created) => {
                    if (created?.type !== "assetModel") return;
                    const assetModel = created.entity;
                    onItemCreated({
                      id: assetModel.id,
                      name: assetModel.name,
                      metadata: { ...assetModel },
                    });
                    closePopover();
                  }}
                />
              )}
            />
            {zo.errors.assetModelId()?.message ? (
              <p className="text-sm text-error-500">
                {zo.errors.assetModelId()?.message}
              </p>
            ) : null}
            {fetcherError ? (
              <p className="text-sm text-error-500">{fetcherError}</p>
            ) : null}
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              width="full"
              disabled={disabled}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
