import { useCallback, useRef, useEffect } from "react";
import type { BarcodeType } from "@prisma/client";
import { tw } from "~/utils/tw";

// Cached import - only loads bwip-js once but keeps it in separate chunk
let bwipjsPromise: Promise<any> | null = null;

const getBwipjs = () => {
  if (!bwipjsPromise) {
    bwipjsPromise = import("@bwip-js/browser");
  }
  return bwipjsPromise;
};

interface BarcodeDisplayProps {
  type: BarcodeType;
  value: string;
  scale?: number; // bwip-js scale parameter (controls overall size)
  height?: number; // Height in mm for linear barcodes (bwip-js uses mm)
  className?: string;
  displayValue?: boolean;
  fontSize?: number;
  maxWidth?: string;
}

export function BarcodeDisplay({
  type,
  value,
  scale = 3, // Good default scale for bwip-js
  height = 12, // 15mm height for linear barcodes
  className,
  displayValue = true,
  fontSize = 8,
  maxWidth = "300px",
}: BarcodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const generateBarcode = useCallback(
    async (canvas: HTMLCanvasElement) => {
      try {
        // Load bwip-js dynamically (cached after first load)
        const bwipjs = await getBwipjs();

        // Map barcode types to bwip-js format strings
        const formatMap: Record<BarcodeType, string> = {
          Code128: "code128",
          Code39: "code39",
          DataMatrix: "datamatrix",
          ExternalQR: "qrcode",
          EAN13: "ean13",
        };

        const bcid = formatMap[type];
        if (!bcid) {
          return;
        }

        // Generate the barcode using bwip-js
        bwipjs.default.toCanvas(canvas, {
          bcid: bcid,
          text: value,
          scale: scale, // Use scale for all barcode types
          // Height only for linear barcodes (not for DataMatrix or QR codes)
          ...(type !== "DataMatrix" &&
            type !== "ExternalQR" && { height: height }),
          includetext: displayValue,
          textxalign: "center",
          textsize: fontSize,
          textgaps: 2,
          backgroundcolor: "ffffff",
          barcolor: "000000",
          textyoffset: 2, // Adjust text position for better visibility
        });
      } catch (error) {
        // Clear canvas and show error
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#ef4444";
          ctx.font = "12px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("Invalid barcode", canvas.width / 2, canvas.height / 2);
        }
      }
    },
    [type, value, scale, height, displayValue, fontSize]
  );

  useEffect(() => {
    if (canvasRef.current) {
      generateBarcode(canvasRef.current).catch((error) => {
        // eslint-disable-next-line no-console
        console.error("Failed to generate barcode:", error);
      });
    }
  }, [generateBarcode]);

  return (
    <canvas
      ref={canvasRef}
      className={tw(`my-4`, className)}
      style={{
        maxWidth: maxWidth,
        maxHeight: "120px",
        width: "auto",
        height: "auto",
      }}
    />
  );
}
