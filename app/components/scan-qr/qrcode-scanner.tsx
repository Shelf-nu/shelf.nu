import React, { useRef, useEffect, useContext, useState } from "react";
import { useNavigate } from "@remix-run/react";
import {
  BrowserMultiFormatReader,
  DecodeHintType,
  BarcodeFormat,
} from "@zxing/library";
import { useClientNotification } from "~/hooks/use-client-notification";
import {
  MediaStreamContext,
  useMediaStream,
  useStopMediaStream,
} from "./media-stream-provider";
import { XIcon } from "../icons";

interface QRScannerProps {
  onClose: () => void;
}

const QRScanner: React.FC<QRScannerProps> = ({ onClose }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastScannedData = useRef<string | null>(null); // to store the last scanned result
  const { videoDevices } = useContext(MediaStreamContext);
  const [sendNotification] = useClientNotification();
  const { stopMediaStream } = useMediaStream();
  useStopMediaStream(stopMediaStream);
  const [scanCompleted, setScanCompleted] = useState(false);
  const navigate = useNavigate();

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

          if (scannedData != null) {
            // Check if the new scanned data is same as the last one
            if (lastScannedData.current !== scannedData) {
              lastScannedData.current = scannedData; // Update the lastScannedData

              const regex =
                /^(https?:\/\/)([^/:]+)(:\d+)?\/qr\/([a-zA-Z0-9]+)$/;
              const match = scannedData.match(regex);

              if (match) {
                stopMediaStream();
                const qrId = match[4]; // Get the last segment of the URL as the QR id

                setScanCompleted(true); // Set the scanCompleted state to true
                // window.location.href = scannedData;

                navigate(`/qr/${qrId}`);
              } else {
                sendNotification({
                  title: "QR Code Not Valid",
                  message: "Please Scan valid asset QR",
                  icon: { name: "trash", variant: "error" },
                });
              }
            }
          }
        }
      });
    }
    return () => {
      codeReader.reset();

      stopMediaStream();
    };
  }, [videoDevices, stopMediaStream, sendNotification, navigate]);

  return (
    <>
      {!scanCompleted && (
        <div className="relative">
          <video ref={videoRef} width="100%" height="720px" autoPlay={true} />
          <button
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-red-500  text-white"
            onClick={onClose}
            title="Close Scanner"
          >
            <XIcon />
          </button>
        </div>
      )}
    </>
  );
};

export default QRScanner;
