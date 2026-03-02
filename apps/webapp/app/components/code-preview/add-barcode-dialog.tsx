import { useState } from "react";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "~/components/shared/tabs";
import { AddBarcodeForm } from "./add-barcode-form";
import { ScanBarcodeTab } from "./scan-barcode-tab";

interface AddBarcodeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: {
    id: string;
    name: string;
    type: "asset" | "kit";
  };
  onRefetchData?: () => void;
}

export function AddBarcodeDialog({
  isOpen,
  onClose,
  item,
  onRefetchData,
}: AddBarcodeDialogProps) {
  const [activeTab, setActiveTab] = useState("input");

  const handleSuccess = () => {
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <DialogPortal>
      <Dialog
        open={isOpen}
        onClose={onClose}
        title={
          <div className="">
            <h3>Add barcode to {item.type}</h3>
          </div>
        }
        className={activeTab === "scan" ? "sm:max-w-full" : "sm:max-w-md"}
      >
        <div
          className={
            activeTab === "scan" ? "flex h-full flex-col" : "px-6 py-3 pt-0"
          }
        >
          <div className={activeTab === "scan" ? "h-full px-6 py-3 pt-0" : ""}>
            <Tabs
              defaultValue="input"
              value={activeTab}
              onValueChange={setActiveTab}
              className={activeTab === "scan" ? "flex h-full flex-col" : ""}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="input">Input code</TabsTrigger>
                <TabsTrigger value="scan">Scan code</TabsTrigger>
              </TabsList>

              <TabsContent value="input">
                <AddBarcodeForm
                  action={`/${item.type === "asset" ? "assets" : "kits"}/${
                    item.id
                  }`}
                  onCancel={handleCancel}
                  onSuccess={handleSuccess}
                  onRefetchData={onRefetchData}
                />
              </TabsContent>

              <TabsContent
                value="scan"
                className={
                  activeTab === "scan" ? "-mx-6 -mb-3 flex-1 md:m-0" : ""
                }
              >
                <ScanBarcodeTab
                  action={`/${item.type === "asset" ? "assets" : "kits"}/${
                    item.id
                  }`}
                  onCancel={handleCancel}
                  onSuccess={handleSuccess}
                  onRefetchData={onRefetchData}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </Dialog>
    </DialogPortal>
  );
}
