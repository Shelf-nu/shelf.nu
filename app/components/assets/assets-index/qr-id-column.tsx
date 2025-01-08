import React, { useState } from "react";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { QrPreview } from "~/components/qr/qr-preview";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import When from "~/components/when/when";
import useApiQuery from "~/hooks/use-api-query";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import { tw } from "~/utils/tw";

type QrIdColumnProps = {
  className?: string;
  style?: React.CSSProperties;
  asset: AdvancedIndexAsset;
};

export default function QrIdColumn({
  className,
  style,
  asset,
}: QrIdColumnProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { isLoading, data, error } = useApiQuery<{
    qrObj: React.ComponentProps<typeof QrPreview>["qrObj"];
  }>({
    api: `/api/assets/${asset.id}/generate-qr-obj`,
    enabled: isDialogOpen,
  });

  function openDialog() {
    setIsDialogOpen(true);
  }

  function closeDialog() {
    setIsDialogOpen(false);
  }

  return (
    <>
      <Td
        className={tw(
          "w-full max-w-none !overflow-visible whitespace-nowrap",
          className
        )}
      >
        <button
          className={tw("hover:underline", className)}
          style={style}
          onClick={openDialog}
        >
          {asset.qrId}
        </button>
      </Td>

      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={closeDialog}
          className="h-[90vh] w-full p-0 md:h-[calc(100vh-4rem)] md:w-1/2"
          title={`QR Id: ${asset.qrId}`}
        >
          <div
            className={
              "relative z-10 flex h-full flex-col bg-white shadow-lg md:rounded"
            }
          >
            <div className="flex max-h-[calc(100%-4rem)] grow items-center justify-center border-y border-gray-200 bg-gray-50">
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
                    name: asset.title,
                    type: "asset",
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
