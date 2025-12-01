import { useState } from "react";
import type { Category, Location } from "@prisma/client";
import NewCategoryForm from "../category/new-category-form";
import { Dialog, DialogPortal } from "../layout/dialog";
import { LocationForm } from "../location/form";
import { Button } from "../shared/button";
import When from "../when/when";

/**
 * Props for the InlineEntityCreationDialog component
 */
type InlineEntityCreationDialogProps = {
  /** Title displayed in the dialog header */
  title: string;
  /** Label for the button that opens the dialog */
  buttonLabel: string;
  /** Type of entity to create (location or category) */
  type: "location" | "category";
  /** Callback invoked when an entity is successfully created */
  onCreated?: (
    entity:
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
  ) => void;
};

/**
 * InlineEntityCreationDialog provides a modal interface for creating locations or categories
 * directly from within dropdown/select components without navigating away.
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
  function handleOpen() {
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
  }

  return (
    <>
      <Button
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
          title={title}
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
            {/* Category creation form */}
            <When truthy={type === "category"}>
              <NewCategoryForm
                apiUrl="/categories/new"
                formClassName="flex-col w-full border-none px-0 py-0"
                className="w-full flex-col"
                inputClassName="w-full lg:max-w-full"
                buttonsClassName="w-full mt-4"
                onCancel={handleClose}
                onSuccess={(data) => {
                  if (data?.category) {
                    onCreated?.({
                      type: "category",
                      entity: {
                        id: data.category.id,
                        name: data.category.name,
                        color: data.category.color,
                        description: data.category.description,
                      },
                    });
                  }

                  handleClose();
                }}
              />
            </When>

            {/* Location creation form */}
            <When truthy={type === "location"}>
              <LocationForm
                apiUrl="/locations/new"
                onCancel={handleClose}
                onSuccess={(data) => {
                  if (data?.location) {
                    onCreated?.({
                      type: "location",
                      entity: {
                        id: data.location.id,
                        name: data.location.name,
                        thumbnailUrl: data.location.thumbnailUrl,
                        imageUrl: data.location.imageUrl,
                      },
                    });
                  }

                  handleClose();
                }}
              />
            </When>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
