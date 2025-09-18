import { cloneElement, forwardRef, useState } from "react";
import type { Asset, Kit, BarcodeType } from "@prisma/client";
import useApiQuery from "~/hooks/use-api-query";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { tw } from "~/utils/tw";
import { CodePreview, type CodeType } from "./code-preview";
import { Dialog, DialogPortal } from "../layout/dialog";
import type { HTMLButtonProps } from "../shared/button";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import When from "../when/when";

type CodePreviewDialogProps = {
  className?: string;
  item:
    | (Pick<Asset, "id" | "title"> & {
        qrId: string;
        type: "asset";
      })
    | (Pick<Kit, "id" | "name"> & {
        qrId: string;
        type: "kit";
      });
  trigger: React.ReactElement<{
    onClick: () => void;
    ref: React.ForwardedRef<HTMLButtonProps>;
  }>;
  selectedBarcodeId?: string;
};

export const CodePreviewDialog = forwardRef<
  HTMLButtonProps,
  CodePreviewDialogProps
>(function ({ className, item, trigger, selectedBarcodeId }, ref) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState<CodeType | null>(null);
  const { canUseBarcodes } = useBarcodePermissions();

  const { isLoading, data, error, refetch } = useApiQuery<{
    qrObj: React.ComponentProps<typeof CodePreview>["qrObj"];
    barcodes: Array<{
      id: string;
      type: BarcodeType;
      value: string;
    }>;
    sequentialId?: string | null;
  }>({
    api: `/api/${item.type === "asset" ? "assets" : "kits"}/${
      item.id
    }/generate-code-obj`,
    enabled: isDialogOpen,
  });

  function openDialog() {
    setIsDialogOpen(true);
  }

  function closeDialog() {
    setIsDialogOpen(false);
  }

  const itemName = item.type === "asset" ? item.title : item.name;

  // Generate dynamic title based on selected code
  const dialogTitle = selectedCode
    ? selectedCode.type === "qr"
      ? `QR Code: ${item.qrId}`
      : `Barcode: ${selectedCode.barcodeData?.value || selectedCode.id}`
    : `Codes for ${itemName}`;

  return (
    <>
      {cloneElement(trigger, { onClick: openDialog, ref })}

      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={closeDialog}
          className={tw(
            "h-[90vh] w-full p-0 md:h-[calc(100vh-4rem)] md:w-1/2",
            className
          )}
          title={dialogTitle}
        >
          <div
            className={
              "relative z-10 flex h-full flex-col bg-white shadow-lg md:rounded"
            }
          >
            <div className="flex max-h-[calc(100%-4rem)] grow flex-col items-center justify-center border-y border-gray-200 bg-gray-50">
              <When truthy={isLoading}>
                <div className="relative size-full animate-pulse bg-gray-200">
                  <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2">
                    <p>Fetching codes...</p>
                  </div>
                </div>
              </When>
              <When truthy={!!error}>
                <p className="text-center text-error-500">{error}</p>
              </When>
              <When truthy={!isLoading}>
                <Card className="min-w-[360px] px-0">
                  <CodePreview
                    className="mb-0 flex size-full flex-col items-center justify-center border-0"
                    item={{
                      id: item.id,
                      name: itemName,
                      type: item.type,
                    }}
                    qrObj={data?.qrObj}
                    barcodes={canUseBarcodes ? data?.barcodes || [] : []}
                    onCodeChange={setSelectedCode}
                    selectedBarcodeId={selectedBarcodeId}
                    onRefetchData={refetch}
                    sequentialId={data?.sequentialId}
                  />
                </Card>
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
});

CodePreviewDialog.displayName = "CodePreviewDialog";
