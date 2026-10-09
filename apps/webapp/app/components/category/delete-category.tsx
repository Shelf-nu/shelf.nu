/**
 * Delete Category Dialog
 *
 * Permanent delete of one category from the categories index. A category that
 * anything uses (assets, kits, custom fields scoped to it, asset models that
 * default to it) asks for its name to be typed first (see
 * {@link TypeToConfirm}); an unused one keeps the one-click confirm, since
 * deleting it touches nothing else.
 *
 * @see {@link file://../../routes/_layout+/categories.tsx} - Action handler
 */
import type { ReactNode } from "react";
import type { Category } from "@prisma/client";
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

/** What uses a category, as counted by the categories index loader. */
export type CategoryUsage = {
  assets: number;
  kits: number;
  customFields: number;
  assetModelDefaults: number;
};

/**
 * Names, in plain words, what uses a category, e.g. "3 assets and 1 kit".
 *
 * @param usage - The category's relation counts
 * @returns The phrase, or null when nothing uses it
 */
export function describeCategoryUsage(usage: CategoryUsage): string | null {
  const parts = [
    [usage.assets, "asset", "assets"],
    [usage.kits, "kit", "kits"],
    [usage.customFields, "custom field", "custom fields"],
    [usage.assetModelDefaults, "asset model", "asset models"],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export const DeleteCategory = ({
  category,
  trigger,
}: {
  category: Pick<Category, "name" | "id"> & { _count?: CategoryUsage };
  trigger?: ReactNode;
}) => {
  const disabled = useDisabled();
  const confirm = useTypeToConfirm(category.name);
  const usage = category._count ? describeCategoryUsage(category._count) : null;
  // Without counts the dialog cannot tell, so it asks, as for one in use.
  const needsTypedConfirm = !category._count || usage !== null;

  const defaultTrigger = (
    <Button
      disabled={disabled}
      variant="secondary"
      size="sm"
      type="button"
      className="text-[12px]"
      icon={"trash"}
      title={"Delete"}
      data-test-id="deleteCategoryButton"
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
          <AlertDialogTitle>Delete {category.name}</AlertDialogTitle>
          <AlertDialogDescription>
            {usage
              ? `This category is used by ${usage}. They are kept, without this category.${
                  category._count?.customFields
                    ? " A custom field limited to only this category will then show on every asset."
                    : ""
                } This cannot be undone.`
              : "This permanently deletes the category. This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needsTypedConfirm ? (
          <TypeToConfirm
            expected={category.name}
            value={confirm.value}
            onChange={confirm.setValue}
            disabled={disabled}
          />
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="secondary" disabled={disabled}>
              Cancel
            </Button>
          </AlertDialogCancel>
          <Form method="delete" action="/categories">
            <input type="hidden" name="id" value={category.id} />
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              data-test-id="confirmDeleteCategoryButton"
              disabled={disabled || (needsTypedConfirm && !confirm.isConfirmed)}
            >
              {disabled ? "Deleting..." : "Delete"}
            </Button>
          </Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
