/**
 * Delete Tag Dialog
 *
 * Permanent delete of one tag from the tags index. A tag on any asset or
 * booking asks for its name to be typed first (see {@link TypeToConfirm}); an
 * unused one keeps the one-click confirm, since deleting it touches nothing
 * else. The counts are loaded when the dialog opens, so the tags index does not
 * count usage for every row.
 *
 * @see {@link file://../../routes/_layout+/tags.tsx} - Action handler
 * @see {@link file://../../routes/api+/tags.$tagId.usage.ts} - Counts
 */
import type { ReactNode } from "react";
import { useId } from "react";
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
import useApiQuery from "~/hooks/use-api-query";
import { useDisabled } from "~/hooks/use-disabled";
import type { TagUsage } from "~/modules/tag/service.server";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

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

/**
 * Delete button and dialog for one tag.
 *
 * @param props.tag - The tag to delete
 * @param props.trigger - Replaces the default trash button
 */
export const DeleteTag = ({
  tag,
  trigger,
}: {
  tag: Pick<Tag, "name" | "id">;
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
        <DeleteTagContent tag={tag} />
      </AlertDialogContent>
    </AlertDialog>
  );
};

/**
 * The open dialog's body. Loads what carries the tag and asks for its name
 * only when something does. Until the counts arrive, or if they cannot be
 * loaded, it asks anyway: the safe default. The action re-checks on the server.
 *
 * @param props.tag - The tag to delete
 */
function DeleteTagContent({ tag }: { tag: Pick<Tag, "name" | "id"> }) {
  const disabled = useDisabled();
  const confirm = useTypeToConfirm(tag.name);
  // The field sits outside the form that submits; this links the two.
  const formId = useId();
  const { data } = useApiQuery<{ usage?: TagUsage }>({
    api: `/api/tags/${tag.id}/usage`,
  });
  const counts = data?.usage;
  const usage = counts ? describeTagUsage(counts) : null;
  const needsTypedConfirm = !counts || usage !== null;

  return (
    <>
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
          form={formId}
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
        <Form id={formId} method="delete" action="/tags">
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
    </>
  );
}
