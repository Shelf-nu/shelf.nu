/**
 * Delete Category Dialog
 *
 * Permanent delete of one category from the categories index. A category that
 * anything uses (assets, kits, custom fields scoped to it, asset models that
 * default to it) asks for its name to be typed first (see
 * {@link TypeToConfirm}); an unused one keeps the one-click confirm, since
 * deleting it touches nothing else. The counts are loaded when the dialog
 * opens, so the categories index does not count usage for every row.
 *
 * @see {@link file://../../routes/_layout+/categories.tsx} - Action handler
 * @see {@link file://../../routes/api+/categories.$categoryId.usage.ts} - Counts
 */
import type { ReactNode } from "react";
import { useId } from "react";
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
import useApiQuery from "~/hooks/use-api-query";
import { useDisabled } from "~/hooks/use-disabled";
import type { CategoryUsage } from "~/modules/category/service.server";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

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

/**
 * Delete button and dialog for one category.
 *
 * @param props.category - The category to delete
 * @param props.trigger - Replaces the default trash button
 */
export const DeleteCategory = ({
  category,
  trigger,
}: {
  category: Pick<Category, "name" | "id">;
  trigger?: ReactNode;
}) => {
  const disabled = useDisabled();

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
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {trigger ? trigger : defaultTrigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        {/* Mounted only while open, so each open loads fresh counts and
            starts with an empty field. */}
        <DeleteCategoryContent category={category} />
      </AlertDialogContent>
    </AlertDialog>
  );
};

/**
 * The open dialog's body. Loads what uses the category and asks for its name
 * only when something does. Until the counts arrive, or if they cannot be
 * loaded, it asks anyway: the safe default. The action re-checks on the server.
 *
 * @param props.category - The category to delete
 */
function DeleteCategoryContent({
  category,
}: {
  category: Pick<Category, "name" | "id">;
}) {
  const disabled = useDisabled();
  const confirm = useTypeToConfirm(category.name);
  // The field sits outside the form that submits; this links the two.
  const formId = useId();
  const { data } = useApiQuery<{ usage?: CategoryUsage }>({
    api: `/api/categories/${category.id}/usage`,
  });
  const counts = data?.usage;
  const usage = counts ? describeCategoryUsage(counts) : null;
  const needsTypedConfirm = !counts || usage !== null;

  return (
    <>
      <AlertDialogHeader>
        <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
          <TrashIcon />
        </span>
        <AlertDialogTitle>Delete {category.name}</AlertDialogTitle>
        <AlertDialogDescription>
          {usage
            ? `This category is used by ${usage}. They are kept, without this category.${
                counts?.customFields
                  ? " A custom field limited to only this category will then show on every asset."
                  : ""
              } This cannot be undone.`
            : "This permanently deletes the category. This cannot be undone."}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {needsTypedConfirm ? (
        <TypeToConfirm
          form={formId}
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
        <Form id={formId} method="delete" action="/categories">
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
    </>
  );
}
