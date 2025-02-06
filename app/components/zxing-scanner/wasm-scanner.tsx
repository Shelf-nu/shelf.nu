// app/components/scanner/wasm-scanner.tsx
import { useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { readBarcodes } from "zxing-wasm";
import type { ReadResult } from "zxing-wasm/reader";
import { initializeScanner } from "~/utils/barcode-scanner";
import { tw } from "~/utils/tw";
import SuccessAnimation from "./success-animation";

type WasmScannerProps = {
  onQrDetectionSuccess?: (qrId: string, error?: string) => void | Promise<void>;
  devices: MediaDeviceInfo[];

  isLoading?: boolean;
  backButtonText?: string;
  allowNonShelfCodes?: boolean;
  hideBackButtonText?: boolean;
  className?: string;
  overlayClassName?: string;
  paused?: boolean;
};

export const WasmScanner = ({
  devices,
  onQrDetectionSuccess,
  isLoading: incomingIsLoading,
  backButtonText = "Back",
  allowNonShelfCodes = false,
  hideBackButtonText = false,
  className,
  overlayClassName,
  paused = false,
}: WasmScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>();
  // Add containerRef to measure container dimensions
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize WASM and camera
  useEffect(() => {
    let animationFrame: number;

    const initScanner = async () => {
      // Initialize WASM module
      await initializeScanner();

      // Set up camera stream
      await setupCamera();
      void processFrame();
    };

    // Enhanced camera setup with proper constraints
    const setupCamera = async () => {
      /** Start a stream with the back camera as preference */
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
        },
        audio: false,
      });

      // Get the active device ID from the stream
      const activeTrack = stream.getVideoTracks()[0];
      const settings = activeTrack.getSettings();
      const activeDeviceId = settings.deviceId;

      // Check if the stream device is available in the devices
      const device = devices.find(
        (device) => device.deviceId === activeDeviceId
      );
      if (device) {
        setSelectedDevice(device.deviceId);
      } else {
        // @TODO not sure what will happen if that is false
        setSelectedDevice(devices[0].deviceId);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            updateCanvasSize();
          }
        };
      }
    };

    // Function to update canvas size to match video display size
    const updateCanvasSize = () => {
      if (!videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Get the video's display dimensions (affected by object-fit: cover)
      const videoRect = video.getBoundingClientRect();

      // Set canvas size to match video's display size
      canvas.width = videoRect.width;
      canvas.height = videoRect.height;
    };

    // Enhanced frame processing with proper scaling
    const processFrame = async () => {
      if (!videoRef.current || !canvasRef.current || paused) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      try {
        // Get dimensions
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;

        // Set canvas size to match video size directly
        canvas.width = videoWidth;
        canvas.height = videoHeight;

        // Draw video frame directly without scaling
        ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

        // Get image data for QR detection
        const imageData = ctx.getImageData(0, 0, videoWidth, videoHeight);

        // Attempt to read QR code
        const results = await readBarcodes(imageData, {
          tryHarder: true,
          formats: ["QRCode"],
          maxNumberOfSymbols: 1,
        });

        if (results.length > 0) {
          const result = results[0];
          // Draw the box directly using the position from the QR detection
          drawDetectionBox(ctx, result.position);
          handleDetection(result.text);

          // Debug: draw point at each corner
          const corners = [
            result.position.topLeft,
            result.position.topRight,
            result.position.bottomRight,
            result.position.bottomLeft,
          ];

          corners.forEach((corner) => {
            ctx.fillStyle = "red";
            ctx.fillRect(corner.x - 2, corner.y - 2, 4, 4);
          });
        }
      } catch (error) {
        console.error("Frame processing error:", error);
      }

      animationFrame = requestAnimationFrame(processFrame);
    };

    // Initialize scanner
    void initScanner();

    // Add resize observer for responsive canvas
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      // @TODO we have to stop the tracks on cleanup
      // stream?.getTracks().forEach((track) => track.stop());
      resizeObserver.disconnect();
    };
  }, [devices, selectedDevice, paused]);

  // Simple box drawing function
  const drawDetectionBox = (
    ctx: CanvasRenderingContext2D,
    position: ReadResult["position"]
  ) => {
    if (!position) return;

    // Set drawing styles
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#22c55e"; // Green color for visibility

    // Draw the detection box
    ctx.moveTo(position.topLeft.x, position.topLeft.y);
    ctx.lineTo(position.topRight.x, position.topRight.y);
    ctx.lineTo(position.bottomRight.x, position.bottomRight.y);
    ctx.lineTo(position.bottomLeft.x, position.bottomLeft.y);
    ctx.closePath();

    // Stroke the path
    ctx.stroke();
  };

  const handleDetection = (result: string) => {
    if (!result || incomingIsLoading) return;
    console.log(result);
    return;
    // // QR code validation logic...
    // const regex = /^(https?:\/\/[^/]+\/(?:qr\/)?([a-zA-Z0-9]+))$/;
    // const match = result.match(regex);

    // if (!match && !allowNonShelfCodes) {
    //   void onQrDetectionSuccess?.(
    //     result,
    //     "Scanned code is not a valid Shelf QR code."
    //   );
    //   return;
    // }

    // // Vibrate on successful scan
    // if (typeof navigator.vibrate === "function") {
    //   navigator.vibrate(200);
    // }

    // const qrId = match ? match[2] : result;
    // if (match && !isQrId(qrId)) {
    //   void onQrDetectionSuccess?.(qrId, "Invalid QR code format");
    //   return;
    // }

    // void onQrDetectionSuccess?.(qrId);
  };

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDevice(deviceId);
  };

  return (
    <div className={tw("scanner-container", className)}>
      <div className="relative size-full overflow-hidden rounded-lg">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="pointer-events-none size-full object-cover"
          style={{ objectFit: "cover" }}
        />
        <canvas ref={canvasRef} className="canvas-overlay size-full" />
        {/* Camera controls overlay */}
        <div className="absolute inset-x-0 top-0 z-10 flex w-full items-center justify-between bg-transparent text-white">
          <div>
            {!hideBackButtonText && (
              <Link
                to=".."
                className="inline-flex items-center justify-start p-2 text-[11px] leading-[11px] text-white"
              >
                <TriangleLeftIcon className="size-[14px]" />
                <span className="mt-[-0.5px]">{backButtonText}</span>
              </Link>
            )}
          </div>

          <div>
            <select
              value={selectedDevice}
              onChange={(e) => handleDeviceChange(e.target.value)}
              className="z-10 rounded border bg-white/10 p-1 text-sm text-white backdrop-blur-sm"
            >
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
        </div>
        {/* Scanning overlay */}
        <div
          className={tw(
            "absolute left-1/2 top-[75px] h-[400px] w-11/12 max-w-[600px] -translate-x-1/2 rounded border-4 border-white shadow-camera-overlay",
            overlayClassName
          )}
        >
          {paused && (
            <div className="flex h-full flex-col items-center justify-center p-4 text-center">
              <h5>Code detected</h5>
              <ClientOnly fallback={null}>
                {() => <SuccessAnimation />}
              </ClientOnly>
              <p>Scanner paused</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
