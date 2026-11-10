import { lazy, useState } from "react";
import type { AssetModel, Category, Location } from "@prisma/client";
import { useInlineCreatePermissions } from "~/hooks/use-inline-create-permissions";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { LazyLoadBoundary } from "../shared/lazy-load-boundary";
import { Spinner } from "../shared/spinner";

/* Lazy: the dialog sits closed inside selects on the asset index and many
 * forms, and its forms bring the markdown editor. They load when it opens. */
const LazyForms = lazy(() => import("./inline-entity-creation-forms"));

/** What the dialog created, passed to `onCreated`. */
export type InlineEntityCreated =
  | {
      type: "location";
      entity: Pick<Location, "id" | "name"> & {
        thumbnailUrl?: string | null;
        imageUrl?: string | null;
      };
    }
  | {
      type: "category";
      entity: Pick<Category, "id" | "name" | "color"> & {
        description?: string | null;
      };
    }
  | {
      type: "assetModel";
      entity: Pick<AssetModel, "id" | "name"> & {
        description?: string | null;
      };
    };

/**
 * Props for the InlineEntityCreationDialog component
 */
type InlineEntityCreationDialogProps = {
  /** Title displayed in the dialog header */
  title: string;
  /** Label for the button that opens the dialog */
  buttonLabel: string;
  /** Type of entity to create (location, category, or assetModel) */
  type: "location" | "category" | "assetModel";
  /** Callback invoked when an entity is successfully created */
  onCreated?: (created: InlineEntityCreated) => void;
};

/**
 * InlineEntityCreationDialog provides a modal interface for creating locations,
 * categories or asset models directly from within dropdown/select components
 * without navigating away.
 *
 * It renders nothing for a member without that entity's `create` permission
 * (`useInlineCreatePermissions`), so callers pass it unconditionally. Inside a
 * `DynamicSelect`, the empty extra-content row then collapses.
 *
 * The dialog uses a z-index of 9999 because it's rendered inside a popover (z-index ~9998)
 * within the DynamicSelect component. This ensures the dialog appears above the select
 * popover overlay. When creating locations, the parent location selector needs z-10000
 * to stack above this dialog.
 *
 * @example
 * <InlineEntityCreationDialog
 *   title="Create Location"
 *   buttonLabel="+ New Location"
 *   type="location"
 *   onCreated={(data) => console.log('Created:', data)}
 * />
 */
export default function InlineEntityCreationDialog({
  title,
  buttonLabel,
  type,
  onCreated,
}: InlineEntityCreationDialogProps) {
  const [open, setOpen] = useState(false);
  const canCreate = useInlineCreatePermissions()[type];

  if (!canCreate) return null;

  function handleOpen() {
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="link"
        icon="plus"
        aria-label={buttonLabel}
        className="w-full justify-start pt-4"
        onClick={handleOpen}
      >
        {buttonLabel}
      </Button>

      <DialogPortal>
        <Dialog
          wrapperClassName="!z-[9999]"
          open={open}
          onClose={handleClose}
          title={<h4>{title}</h4>}
          className={
            type === "location"
              ? "md:!w-full md:!max-w-3xl"
              : "md:!w-full md:!max-w-lg"
          }
        >
          {/*
            z-index is set to 9999 because this dialog is rendered inside a popover (z-index ~9998)
            within the DynamicSelect component. Without this, the dialog would appear behind
            the popover overlay, making it inaccessible to users.
          */}
          <div
            className={type === "location" ? "border-t" : "border-t px-6 py-5"}
          >
            <LazyLoadBoundary
              loading={
                <div className="flex justify-center py-10">
                  <Spinner className="size-6" />
                </div>
              }
              failed={
                <p className="py-10 text-center text-sm text-error-500">
                  The form could not be loaded. Reload the page and try again.
                </p>
              }
            >
              <LazyForms
                type={type}
                onCreated={onCreated}
                onClose={handleClose}
              />
            </LazyLoadBoundary>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
