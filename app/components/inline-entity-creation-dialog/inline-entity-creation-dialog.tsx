import { useState } from "react";
import type { Category, Location } from "@prisma/client";
import NewCategoryForm from "../category/new-category-form";
import { Dialog, DialogPortal } from "../layout/dialog";
import { LocationForm } from "../location/form";
import { Button } from "../shared/button";

type InlineEntityCreationDialogProps = {
  title: string;
  buttonLabel: string;
  type: "location" | "category";
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
          className="md:!w-full md:!max-w-lg"
        >
          <div className="border-t px-6 py-5">
            {(() => {
              switch (type) {
                case "category": {
                  return (
                    <NewCategoryForm
                      apiUrl="/categories/new"
                      formClassName="flex-col w-full border-none px-0 py-0"
                      className="w-full flex-col"
                      inputClassName="w-full lg:max-w-full"
                      buttonsClassName="w-full mt-4"
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
                  );
                }

                case "location": {
                  return (
                    <LocationForm
                      apiUrl="/locations/new"
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
                  );
                }

                default:
                  return null;
              }
            })()}
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
