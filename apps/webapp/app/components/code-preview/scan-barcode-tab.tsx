import { useState, useMemo } from "react";
import type { BarcodeType } from "@prisma/client";
import { BarcodeDisplay } from "~/components/barcode/barcode-display";
import { CodeScanner } from "~/components/scanner/code-scanner";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { BARCODE_TYPE_OPTIONS } from "~/modules/barcode/constants";
import { AddBarcodeForm } from "./add-barcode-form";

interface ScanBarcodeTabProps {
  onCancel: () => void;
  onSuccess: () => void;
  action: string;
  onRefetchData?: () => void;
}

export function ScanBarcodeTab({
  onCancel,
  onSuccess,
  action,
  onRefetchData,
}: ScanBarcodeTabProps) {
  const [paused, setPaused] = useState(false);
  const [scannedValue, setScannedValue] = useState<string | null>(null);
  const [detectedType, setDetectedType] = useState<BarcodeType | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const savedCameraId = useScannerCameraId();

  // Handle scan results from CodeScanner
  const handleScanSuccess = ({
    value,
    type,
    error,
    barcodeType,
  }: OnCodeDetectionSuccessProps) => {
    // Let the scanner handle error display
    if (error) {
      setErrorMessage(error);
    }

    // Only process barcodes in this context
    if (type === "barcode" && barcodeType) {
      setScannedValue(value);
      setDetectedType(barcodeType);
      setPaused(true);
    } else {
      // Let scanner show error for non-barcode types or missing barcode type
      return;
    }
  };

  const helpText = useMemo(() => {
    if (detectedType) {
      const option = BARCODE_TYPE_OPTIONS.find(
        (opt) => opt.value === detectedType
      );
      return option ? option.description : undefined;
    }
    return undefined;
  }, [detectedType]);

  // Form component to show when barcode is detected
  const barcodeForm =
    scannedValue && detectedType ? (
      <div className="w-full max-w-none space-y-3 text-left">
        {/* Detected Barcode Preview */}
        <div className="rounded-lg border bg-gray-50 p-3">
          <h4 className="mb-2 text-sm font-medium text-gray-900">
            Detected Barcode
          </h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                {detectedType}
              </span>
              <span className="truncate font-mono text-sm text-gray-700">
                {scannedValue}
              </span>
            </div>
            {helpText && <p className="text-xs text-gray-600">{helpText}</p>}
          </div>
          <div className="mt-2 flex justify-center">
            <BarcodeDisplay
              type={detectedType}
              value={scannedValue}
              maxWidth="150px"
            />
          </div>
        </div>

        {/* Form for submission */}
        <AddBarcodeForm
          action={action}
          onCancel={onCancel}
          onSuccess={onSuccess}
          onRefetchData={onRefetchData}
          hideFields={true}
          initialBarcodeType={detectedType}
          initialBarcodeValue={scannedValue}
        />
      </div>
    ) : null;

  return (
    <div className="flex h-full flex-col">
      {/* Scanner Interface */}
      <div className="flex-1">
        <CodeScanner
          onCodeDetectionSuccess={handleScanSuccess}
          paused={paused}
          setPaused={setPaused}
          allowNonShelfCodes={true}
          hideBackButtonText={true}
          scanMessage={barcodeForm}
          className="h-full"
          forceMode="camera"
          overlayPosition="centered"
          errorMessage={errorMessage}
          savedCameraId={savedCameraId}
        />
      </div>
    </div>
  );
}
