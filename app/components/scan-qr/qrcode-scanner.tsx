import React, { useRef, useEffect, useContext } from "react";
import {
  BrowserMultiFormatReader,
  DecodeHintType,
  BarcodeFormat,
} from "@zxing/library";
import { MediaStreamContext } from "./media-stream-provider";
import { XIcon } from "../icons";

interface QRScannerProps {
  onScan: (data: string | null) => void;
  onClose: () => void;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastScannedData = useRef<string | null>(null); // to store the last scanned result
  const { videoDevices } = useContext(MediaStreamContext);

  useEffect(() => {
    const codeReader = new BrowserMultiFormatReader();
    const hints = new Map<DecodeHintType, any>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    codeReader.hints = hints;

    if (videoRef.current) {
      codeReader.decodeFromVideoDevice(null, videoRef.current, (result) => {
        if (result) {
          const scannedData = result.getText();

          // Check if the new scanned data is same as the last one
          if (lastScannedData.current !== scannedData) {
            onScan(scannedData || null); // Ensure you pass a valid value
            lastScannedData.current = scannedData; // Update the lastScannedData
          }
        }
      });
    }
  }, [videoDevices, onScan]);

  return (
    <div className="relative">
      <video ref={videoRef} width="100%" height="720px" autoPlay={true} />
    </div>
  );
};

export default QRScanner;
