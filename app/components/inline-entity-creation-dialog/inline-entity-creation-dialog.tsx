import { useState } from "react";
import NewCategoryForm from "../category/new-category-form";
import { Dialog, DialogPortal } from "../layout/dialog";
import { LocationForm } from "../location/form";
import { Button } from "../shared/button";

type InlineEntityCreationDialogProps = {
  title: string;
  buttonLabel: string;
  type: "location" | "category";
};

export default function InlineEntityCreationDialog({
  title,
  buttonLabel,
  type,
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
          title={title}
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
                      onSuccess={handleClose}
                    />
                  );
                }

                case "location": {
                  return (
                    <LocationForm
                      apiUrl="/locations/new"
                      onSuccess={handleClose}
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
