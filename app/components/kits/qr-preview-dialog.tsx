import { cloneElement, useState } from "react";
import type { Kit } from "@prisma/client";
import useApiQuery from "~/hooks/use-api-query";
import { tw } from "~/utils/tw";
import { Dialog, DialogPortal } from "../layout/dialog";
import { QrPreview } from "../qr/qr-preview";
import { Button } from "../shared/button";
import When from "../when/when";

type QrPreviewDialogProps = {
  className?: string;
  kit: Pick<Kit, "id" | "name"> & {
    qrId: string;
  };
  trigger: React.ReactElement<{ onClick: () => void }>;
};

export default function QrPreviewDialog({
  className,
  kit,
  trigger,
}: QrPreviewDialogProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { isLoading, data, error } = useApiQuery<{
    qrObj: React.ComponentProps<typeof QrPreview>["qrObj"];
  }>({
    api: `/api/kits/${kit.id}/generate-qr-obj`,
    enabled: isDialogOpen,
  });

  function closeDialog() {
    setIsDialogOpen(false);
  }

  function openDialog() {
    setIsDialogOpen(true);
  }

  return (
    <>
      {cloneElement(trigger, { onClick: openDialog })}

      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={closeDialog}
          className={tw(
            "h-[90vh] w-full p-0 md:h-[calc(100vh-4rem)] md:w-1/2",
            className
          )}
          title={`QR Id: ${kit.qrId}`}
        >
          <div className="relative z-10 flex h-full flex-col bg-white shadow-lg md:rounded">
            <div className="flex max-h-[calc(100%-4rem)] grow flex-col items-center justify-center border-y border-gray-200 bg-gray-50">
              <When truthy={isLoading}>
                <div className="relative size-full animate-pulse bg-gray-200">
                  <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2">
                    <p>Fetching qr code...</p>
                  </div>
                </div>
              </When>
              <When truthy={!!error}>
                <p className="text-center text-error-500">{error}</p>
              </When>
              <When truthy={!isLoading}>
                <QrPreview
                  className="mb-0 flex size-full flex-col items-center justify-center"
                  item={{
                    name: kit.name,
                    type: "kit",
                  }}
                  qrObj={data?.qrObj}
                />
              </When>
            </div>
            <div className="flex w-full justify-center gap-3 px-6 py-3 md:justify-end">
              <Button variant="secondary" onClick={closeDialog}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
