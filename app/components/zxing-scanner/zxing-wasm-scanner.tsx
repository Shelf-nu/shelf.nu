import { useEffect, useRef, useState } from "react";
import {
  BrowserMultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
} from "zxing-wasm";

const ZXingWasmScanner = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [selectedFormat, setSelectedFormat] = useState<BarcodeFormat | "">("");
  const [isFastMode, setIsFastMode] = useState(true);
  const [result, setResult] = useState<string>("");
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  // Initialize scanner and list cameras
  useEffect(() => {
    const init = async () => {
      try {
        // Initialize reader with selected format and mode
        const hints = new Map<DecodeHintType, any>();
        hints.set(
          DecodeHintType.POSSIBLE_FORMATS,
          selectedFormat ? [selectedFormat] : Object.values(BarcodeFormat)
        );
        hints.set(DecodeHintType.TRY_HARDER, !isFastMode);

        readerRef.current = new BrowserMultiFormatReader(hints);

        // List available cameras
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput"
        );
        setDevices(videoDevices);
        setSelectedDeviceId(videoDevices[0]?.deviceId || "");
      } catch (err) {
        console.error("Error initializing scanner:", err);
      }
    };

    init();

    return () => {
      readerRef.current?.reset();
    };
  }, [selectedFormat, isFastMode]);

  // Start/stop scanning when device or settings change
  useEffect(() => {
    const startScanning = async () => {
      if (
        !readerRef.current ||
        !selectedDeviceId ||
        !videoRef.current ||
        !canvasRef.current
      )
        return;

      try {
        await readerRef.current.decodeFromVideoDevice(
          selectedDeviceId,
          videoRef.current,
          (result, error) => {
            const canvas = canvasRef.current!;
            const ctx = canvas.getContext("2d")!;

            // Clear previous frame
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (result) {
              // Draw detection square
              ctx.strokeStyle = "red";
              ctx.lineWidth = 4;

              const { topLeft, topRight, bottomRight, bottomLeft } =
                result.getResultPoints();
              ctx.beginPath();
              ctx.moveTo(topLeft.x, topLeft.y);
              ctx.lineTo(topRight.x, topRight.y);
              ctx.lineTo(bottomRight.x, bottomRight.y);
              ctx.lineTo(bottomLeft.x, bottomLeft.y);
              ctx.lineTo(topLeft.x, topLeft.y);
              ctx.stroke();

              setResult(`${result.getBarcodeFormat()}: ${result.getText()}`);
            }

            if (error) {
              console.error("Decoding error:", error);
              setResult("No barcode found");
            }
          }
        );

        // Update video/canvas dimensions
        const updateDimensions = () => {
          if (videoRef.current && canvasRef.current) {
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
          }
        };

        videoRef.current.addEventListener("resize", updateDimensions);
        return () =>
          videoRef.current?.removeEventListener("resize", updateDimensions);
      } catch (err) {
        console.error("Error starting scan:", err);
      }
    };

    startScanning();

    return () => {
      readerRef.current?.reset();
    };
  }, [selectedDeviceId, selectedFormat, isFastMode]);

  return (
    <div className="scanner-container relative mx-auto w-full max-w-2xl">
      {/* Controls */}
      <div className="controls mb-4">
        <select
          className="rounded border p-2"
          value={selectedDeviceId}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
        >
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Camera ${device.deviceId.slice(-5)}`}
            </option>
          ))}
        </select>

        <select
          className="ml-2 rounded border p-2"
          value={selectedFormat}
          onChange={(e) => setSelectedFormat(e.target.value as BarcodeFormat)}
        >
          <option value="">Any</option>
          {Object.entries(BarcodeFormat).map(([key, value]) => (
            <option key={key} value={value}>
              {key}
            </option>
          ))}
        </select>

        <select
          className="ml-2 rounded border p-2"
          value={isFastMode.toString()}
          onChange={(e) => setIsFastMode(e.target.value === "true")}
        >
          <option value="true">Fast</option>
          <option value="false">Normal</option>
        </select>
      </div>

      {/* Video & Canvas Overlay */}
      <div className="relative">
        <video
          ref={videoRef}
          className="h-auto w-full"
          autoPlay
          playsInline
          muted
        />

        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute left-0 top-0 size-full"
        />
      </div>

      {/* Result Display */}
      <div className="result mt-4 rounded bg-gray-100 p-2">{result}</div>
    </div>
  );
};

export default ZXingWasmScanner;
