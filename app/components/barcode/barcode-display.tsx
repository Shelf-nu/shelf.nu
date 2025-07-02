import { useEffect, useRef } from "react";
import type { BarcodeType } from "@prisma/client";
import JsBarcode from "jsbarcode";

interface BarcodeDisplayProps {
  type: BarcodeType;
  value: string;
  width?: number;
  height?: number;
  className?: string;
  displayValue?: boolean;
  fontSize?: number;
  margin?: number;
}

export function BarcodeDisplay({
  type,
  value,
  width = 2,
  height = 80,
  className,
  displayValue = true,
  fontSize = 14,
  margin = 10,
}: BarcodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      // Handle MicroQRCode by showing a placeholder for now
      if (type === "MicroQRCode") {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Set canvas size
          canvas.width = 200;
          canvas.height = height + 40;

          // Clear canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Show placeholder message
          ctx.fillStyle = "#6b7280";
          ctx.font = "12px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            "MicroQR preview",
            canvas.width / 2,
            canvas.height / 2 - 10
          );
          ctx.fillText("coming soon", canvas.width / 2, canvas.height / 2 + 10);

          if (displayValue) {
            ctx.fillStyle = "#374151";
            ctx.font = `${fontSize}px sans-serif`;
            ctx.fillText(value, canvas.width / 2, canvas.height - 15);
          }
        }
        return;
      }

      // Map barcode types to JSBarcode format strings
      const formatMap: Record<Exclude<BarcodeType, "MicroQRCode">, string> = {
        Code128: "CODE128",
        Code39: "CODE39",
      };

      const format = formatMap[type as Exclude<BarcodeType, "MicroQRCode">];
      if (!format) {
        return;
      }

      // Generate the barcode using JSBarcode
      JsBarcode(canvas, value, {
        format,
        width,
        height,
        displayValue,
        fontSize,
        textMargin: 2,
        margin,
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
  }, [type, value, width, height, displayValue, fontSize, margin]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ maxWidth: "100%" }}
    />
  );
}
