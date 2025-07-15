import React, { useRef, useMemo, useState } from "react";
import type { BarcodeType } from "@prisma/client";
import { changeDpiDataUrl } from "changedpi";
import { toPng } from "html-to-image";
import { useReactToPrint } from "react-to-print";
import { BarcodeDisplay } from "~/components/barcode/barcode-display";
import { Button } from "~/components/shared/button";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { slugify } from "~/utils/slugify";
import { tw } from "~/utils/tw";
import { AddBarcodeForm } from "./add-barcode-form";
import { Dialog } from "../layout/dialog";
import { CrispButton } from "../marketing/crisp";
import When from "../when/when";

type SizeKeys = "cable" | "small" | "medium" | "large";

export interface CodeType {
  id: string;
  type: "qr" | "barcode";
  label: string;
  // QR specific
  qrData?: {
    size: SizeKeys;
    src: string;
  };
  // Barcode specific
  barcodeData?: {
    type: BarcodeType;
    value: string;
  };
}

interface CodePreviewProps {
  className?: string;
  style?: React.CSSProperties;
  hideButton?: boolean;
  item: {
    id: string; // Need the ID to construct the action URL
    name: string;
    type: "asset" | "kit";
  };
  qrObj?: {
    qr?: {
      size: SizeKeys;
      id: string;
      src: string;
    };
  };
  barcodes?: Array<{
    id: string;
    type: BarcodeType;
    value: string;
  }>;
  onCodeChange?: (code: CodeType | null) => void;
  selectedBarcodeId?: string;
  onRefetchData?: () => void; // Callback to refetch data when barcode is added
}

export const CodePreview = ({
  className,
  style,
  qrObj,
  barcodes = [],
  item,
  hideButton = false,
  onCodeChange,
  selectedBarcodeId,
  onRefetchData,
}: CodePreviewProps) => {
  const captureDivRef = useRef<HTMLImageElement>(null);
  const downloadBtnRef = useRef<HTMLAnchorElement>(null);
  const { canUseBarcodes } = useBarcodePermissions();
  const [isAddBarcodeDialogOpen, setIsAddBarcodeDialogOpen] = useState(false);

  // Build available codes list
  const availableCodes: CodeType[] = useMemo(() => {
    const codes: CodeType[] = [];

    // Add QR code if available
    if (qrObj?.qr) {
      codes.push({
        id: qrObj.qr.id,
        type: "qr",
        label: "Shelf QR Code",
        qrData: {
          size: qrObj.qr.size,
          src: qrObj.qr.src,
        },
      });
    }

    // Add barcodes if available and permissions allow
    if (canUseBarcodes) {
      barcodes.forEach((barcode) => {
        codes.push({
          id: barcode.id,
          type: "barcode",
          label: `${barcode.type} - ${barcode.value}`,
          barcodeData: {
            type: barcode.type,
            value: barcode.value,
          },
        });
      });
    }

    return codes;
  }, [qrObj, barcodes, canUseBarcodes]);

  // Default to selected barcode, then QR code if available, otherwise first barcode
  const [selectedCodeId, setSelectedCodeId] = useState<string>(() => {
    // If a specific barcode is selected, prioritize it
    if (selectedBarcodeId) {
      const selectedBarcode = availableCodes.find(
        (code) => code.id === selectedBarcodeId
      );
      if (selectedBarcode) {
        // Notify parent of initial selection
        if (onCodeChange) {
          onCodeChange(selectedBarcode);
        }
        return selectedBarcodeId;
      }
    }

    // Otherwise default to QR code if available, then first barcode
    const qrCode = availableCodes.find((code) => code.type === "qr");
    const defaultId = qrCode?.id || availableCodes[0]?.id || "";

    // Notify parent of initial selection
    const initialCode = availableCodes.find((code) => code.id === defaultId);
    if (onCodeChange && initialCode) {
      onCodeChange(initialCode);
    }

    return defaultId;
  });

  const selectedCode = availableCodes.find(
    (code) => code.id === selectedCodeId
  );

  const fileName = useMemo(() => {
    if (!selectedCode) return "";

    const prefix = `${slugify(item.name || item.type)}`;
    if (selectedCode.type === "qr") {
      return `${prefix}-${selectedCode.qrData?.size}-shelf-qr-code-${selectedCode.id}.png`;
    } else {
      return `${prefix}-${selectedCode.barcodeData?.type}-barcode-${selectedCode.barcodeData?.value}.png`;
    }
  }, [item, selectedCode]);

  function downloadCode(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
    const captureDiv = captureDivRef.current;
    const downloadBtn = downloadBtnRef.current;

    if (captureDiv && downloadBtn) {
      e.preventDefault();
      toPng(captureDiv, {
        height: captureDiv.offsetHeight * 2,
        width: captureDiv.offsetWidth * 2,
        style: {
          transform: `scale(${2})`,
          transformOrigin: "top left",
          width: `${captureDiv.offsetWidth}px`,
          height: `${captureDiv.offsetHeight}px`,
        },
      })
        .then((dataUrl: string) => {
          const downloadLink = document.createElement("a");
          downloadLink.href = changeDpiDataUrl(dataUrl, 300);
          downloadLink.download = fileName;
          downloadLink.click();
          URL.revokeObjectURL(downloadLink.href);
        })
        // eslint-disable-next-line no-console
        .catch(console.error);
    }
  }

  const printCode = useReactToPrint({ content: () => captureDivRef.current });

  // Don't render if no codes available
  if (availableCodes.length === 0) {
    return null;
  }

  return (
    <div
      className={tw("mb-4 w-auto rounded border bg-white", className)}
      style={style}
    >
      {/* Code Selector */}
      <div className="w-full border-b-[1.1px] border-[#E3E4E8] px-4 py-3">
        <div className="flex items-center gap-2">
          <select
            id="code-selector"
            value={selectedCodeId}
            onChange={(e) => {
              setSelectedCodeId(e.target.value);
              const newSelectedCode = availableCodes.find(
                (code) => code.id === e.target.value
              );
              onCodeChange?.(newSelectedCode || null);
            }}
            className="min-w-0 max-w-[280px] flex-1 truncate rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {availableCodes.map((code) => (
              <option key={code.id} value={code.id}>
                {code.label}
              </option>
            ))}
          </select>
          <Button
            icon="plus"
            variant="secondary"
            size="sm"
            onClick={() => setIsAddBarcodeDialogOpen(true)}
            disabled={
              !canUseBarcodes
                ? {
                    reason: (
                      <>
                        Your workspace doesn't currently support barcodes. If
                        you want to enable barcodes for your workspace, please
                        get in touch with{" "}
                        <CrispButton variant="link">sales</CrispButton>.
                      </>
                    ),
                  }
                : false
            }
            tooltip={canUseBarcodes ? "Add code to asset" : undefined}
            className="shrink-0"
          />
        </div>
      </div>

      {/* Code Preview */}
      <div className="flex w-full justify-center pt-6">
        {selectedCode?.type === "qr" ? (
          <QrLabel
            ref={captureDivRef}
            data={{ qr: selectedCode.qrData }}
            title={item.name}
          />
        ) : selectedCode?.type === "barcode" ? (
          <BarcodeLabel
            ref={captureDivRef}
            data={selectedCode.barcodeData}
            title={item.name}
          />
        ) : null}
      </div>

      {/* Actions */}
      <When truthy={!hideButton && !!selectedCode}>
        <div className="mt-8 flex w-full items-center gap-3 border-t-[1.1px] border-[#E3E4E8] px-4 py-3">
          <Button
            icon="download"
            onClick={downloadCode}
            download={fileName}
            ref={downloadBtnRef}
            variant="secondary"
            className="w-full"
          >
            Download
          </Button>
          <Button
            icon="print"
            variant="secondary"
            className="w-full"
            onClick={printCode}
          >
            Print
          </Button>
        </div>
      </When>

      {/* Add Barcode Dialog */}
      <Dialog
        open={isAddBarcodeDialogOpen}
        onClose={() => setIsAddBarcodeDialogOpen(false)}
        title={
          <div className="">
            <h3>Add barcode to {item.type}</h3>
          </div>
        }
        className="sm:max-w-md"
      >
        <div className="px-6 py-3 pt-0">
          <AddBarcodeForm
            action={`/${item.type === "asset" ? "assets" : "kits"}/${item.id}`}
            onCancel={() => setIsAddBarcodeDialogOpen(false)}
            onSuccess={() => setIsAddBarcodeDialogOpen(false)}
            onRefetchData={onRefetchData}
          />
        </div>
      </Dialog>
    </div>
  );
};

// QR Label Component (existing)
export type QrDef = {
  id?: string;
  size?: SizeKeys;
  src?: string;
};

interface QrLabelProps {
  data?: { qr?: QrDef };
  title: string;
}

export const QrLabel = React.forwardRef<HTMLDivElement, QrLabelProps>(
  function QrLabel(props, ref) {
    const { data, title } = props ?? {};

    return (
      <div
        style={{
          width: "300px",
          aspectRatio: 1 / 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "12px",
          borderRadius: "4px",
          border: "5px solid #E3E4E8",
          padding: "24px 17px 24px 17px",
          backgroundColor: "white",
        }}
        ref={ref}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
            color: "black",
            textAlign: "center",
          }}
        >
          {title}
        </div>
        <figure className="qr-code flex justify-center">
          <img
            src={data?.qr?.src}
            alt={`${data?.qr?.size}-shelf-qr-code.png`}
          />
        </figure>
        <div style={{ width: "100%", textAlign: "center", fontSize: "12px" }}>
          <div style={{ fontWeight: 600 }}>{data?.qr?.id}</div>
          <div>
            Powered by{" "}
            <span style={{ fontWeight: 600, color: "black" }}>shelf.nu</span>
          </div>
        </div>
      </div>
    );
  }
);

// Barcode Label Component (new)
interface BarcodeLabelProps {
  data?: {
    type: BarcodeType;
    value: string;
  };
  title: string;
}

export const BarcodeLabel = React.forwardRef<HTMLDivElement, BarcodeLabelProps>(
  function BarcodeLabel(props, ref) {
    const { data, title } = props ?? {};

    if (!data) return null;

    return (
      <div
        style={{
          width: "300px",
          minHeight: "300px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "12px",
          borderRadius: "4px",
          border: "5px solid #E3E4E8",
          padding: "24px 17px 24px 17px",
          backgroundColor: "white",
        }}
        ref={ref}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
            color: "black",
            textAlign: "center",
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexGrow: 1,
          }}
        >
          <BarcodeDisplay
            type={data.type}
            value={data.value}
            maxWidth="250px"
          />
        </div>
        <div style={{ width: "100%", textAlign: "center", fontSize: "12px" }}>
          <div style={{ fontWeight: 600 }}>
            {data.type}:{" "}
            <div
              style={{
                wordBreak: "break-all",
                overflowWrap: "break-word",
                lineHeight: "1.2",
              }}
            >
              {data.value}
            </div>
          </div>
          <div>
            Powered by{" "}
            <span style={{ fontWeight: 600, color: "black" }}>shelf.nu</span>
          </div>
        </div>
      </div>
    );
  }
);
