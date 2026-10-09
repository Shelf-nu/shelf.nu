/**
 * Delete Location Dialog
 *
 * Permanent delete of one location, from the location page's actions menu and
 * the locations index row actions. The user types the location's name before
 * Delete is enabled (see {@link TypeToConfirm}).
 *
 * @see {@link file://../../routes/_layout+/locations.$locationId.tsx} - Action handler
 */
import type { ReactNode } from "react";
import type { Location } from "@prisma/client";
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

type DeleteLocationProps = {
  location: {
    name: Location["name"];
    id: Location["id"];
    childCount?: number;
  };
  trigger?: ReactNode;
};

export const DeleteLocation = ({ location, trigger }: DeleteLocationProps) => {
  const disabled = useDisabled();
  const confirm = useTypeToConfirm(location.name);

  return (
    <AlertDialog
      onOpenChange={(open) => {
        // Each open starts empty, so an earlier attempt never arms the button.
        if (!open) confirm.reset();
      }}
    >
      <AlertDialogTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="link"
            data-test-id="deleteAssetButton"
            icon="trash"
            className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700"
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
          <AlertDialogTitle>Delete {location.name}</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the location with its notes and image.
            Assets and kits stored here are left without a location. This cannot
            be undone.
          </AlertDialogDescription>
          {location.childCount && location.childCount > 0 ? (
            <div className="rounded border border-warning-200 bg-warning-50 p-3 text-sm text-warning-900">
              This location has <strong>{location.childCount}</strong> child
              {location.childCount > 1 ? " locations" : " location"}. They will
              move to the root level if you delete this location.
            </div>
          ) : null}
        </AlertDialogHeader>

        <TypeToConfirm
          expected={location.name}
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

            <Form method="delete" action={`/locations/${location.id}`}>
              <Button
                className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
                type="submit"
                data-test-id="confirmdeleteLocationButton"
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
};
