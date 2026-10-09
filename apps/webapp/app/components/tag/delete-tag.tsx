/**
 * Delete Tag Dialog
 *
 * Permanent delete of one tag from the tags index. A tag on any asset or
 * booking asks for its name to be typed first (see {@link TypeToConfirm}); an
 * unused one keeps the one-click confirm, since deleting it touches nothing
 * else.
 *
 * @see {@link file://../../routes/_layout+/tags.tsx} - Action handler
 */
import type { ReactNode } from "react";
import type { Tag } from "@prisma/client";
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

/** What carries a tag, as counted by the tags index loader. */
export type TagUsage = { assets: number; bookings: number };

/**
 * Names, in plain words, what carries a tag, e.g. "4 assets and 1 booking".
 *
 * @param usage - The tag's relation counts
 * @returns The phrase, or null when nothing carries it
 */
export function describeTagUsage(usage: TagUsage): string | null {
  const parts = [
    [usage.assets, "asset", "assets"],
    [usage.bookings, "booking", "bookings"],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);

  return parts.length > 0 ? parts.join(" and ") : null;
}

export const DeleteTag = ({
  tag,
  trigger,
}: {
  tag: Pick<Tag, "name" | "id"> & { _count?: TagUsage };
  trigger?: ReactNode;
}) => {
  const disabled = useDisabled();
  const confirm = useTypeToConfirm(tag.name);
  const usage = tag._count ? describeTagUsage(tag._count) : null;
  // Without counts the dialog cannot tell, so it asks, as for one in use.
  const needsTypedConfirm = !tag._count || usage !== null;

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
          <AlertDialogTitle>Delete {tag.name}</AlertDialogTitle>
          <AlertDialogDescription>
            {usage
              ? `This tag is on ${usage}. It is removed from them; they are kept. This cannot be undone.`
              : "This permanently deletes the tag. This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needsTypedConfirm ? (
          <TypeToConfirm
            expected={tag.name}
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
          <Form method="delete" action="/tags">
            <input type="hidden" name="id" value={tag.id} />
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
