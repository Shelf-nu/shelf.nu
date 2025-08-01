import { useCallback } from "react";
import bwipjs from "@bwip-js/browser";
import type { BarcodeType } from "@prisma/client";
import { tw } from "~/utils/tw";

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
  const generateBarcode = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;

      try {
        // Map barcode types to bwip-js format strings
        const formatMap: Record<BarcodeType, string> = {
          Code128: "code128",
          Code39: "code39",
          DataMatrix: "datamatrix",
          ExternalQR: "qrcode",
        };

        const bcid = formatMap[type];
        if (!bcid) {
          return;
        }

        // Generate the barcode using bwip-js
        bwipjs.toCanvas(canvas, {
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

  return (
    <canvas
      ref={(canvas) => generateBarcode(canvas)}
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
