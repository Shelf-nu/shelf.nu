/**
 * Delete Kit Dialog
 *
 * Permanent delete of one kit, from the kit page's actions menu and the kits
 * index row actions. The user types the kit's name before Delete is enabled
 * (see {@link TypeToConfirm}).
 *
 * @see {@link file://../../routes/_layout+/kits.$kitId.tsx} - Action handler
 */
import type { ReactElement } from "react";
import { cloneElement, useId } from "react";
import type { Kit } from "@prisma/client";
import {
  TypeToConfirm,
  useTypeToConfirm,
} from "~/components/shared/type-to-confirm";
import { useDisabled } from "~/hooks/use-disabled";
import { Form } from "../custom-form";
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

type DeleteKitProps = {
  kit: Pick<Kit, "id" | "name" | "image">;
  trigger?: ReactElement;
};

export default function DeleteKit({ kit, trigger }: DeleteKitProps) {
  const disabled = useDisabled();
  const confirm = useTypeToConfirm(kit.name);
  // The field sits outside the form that submits; this links the two.
  const formId = useId();

  return (
    <AlertDialog
      onOpenChange={(open) => {
        // Each open starts empty, so an earlier attempt never arms the button.
        if (!open) confirm.reset();
      }}
    >
      <AlertDialogTrigger asChild>
        {trigger ? (
          cloneElement(trigger)
        ) : (
          <Button
            type="button"
            variant="link"
            icon="trash"
            className="justify-start rounded-sm px-4 py-3 text-sm font-semibold text-gray-700 outline-none  hover:bg-slate-100 hover:text-gray-700"
            width="full"
          >
            Delete
          </Button>
        )}
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <TrashIcon />
            </span>
          </div>
          <AlertDialogTitle>Delete {kit.name}</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the kit. Its assets stay in your workspace
            and keep their location, but leave the draft and reserved bookings
            the kit was on. Custody of the kit is released and its QR code is
            unlinked. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <TypeToConfirm
          form={formId}
          expected={kit.name}
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

            <Form id={formId} method="delete" action={`/kits/${kit.id}`}>
              {kit.image && (
                <input type="hidden" value={kit.image} name="image" />
              )}
              <input type="hidden" value="delete" name="intent" />
              <Button
                type="submit"
                className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
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
