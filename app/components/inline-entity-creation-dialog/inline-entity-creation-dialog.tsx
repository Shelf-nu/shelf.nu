import { useState } from "react";
import NewCategoryForm from "../category/new-category-form";
import { Dialog, DialogPortal } from "../layout/dialog";
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
          className="z-[9999]"
        >
          {(() => {
            switch (type) {
              case "category": {
                return (
                  <NewCategoryForm
                    apiUrl="/categories/new"
                    formClassName="flex-col w-full"
                    className="w-full flex-col"
                    inputClassName="w-full lg:max-w-full"
                    buttonsClassName="w-full mt-4"
                    onSuccess={() => {
                      handleClose();
                    }}
                  />
                );
              }

              default:
                return null;
            }
          })()}
        </Dialog>
      </DialogPortal>
    </>
  );
}
