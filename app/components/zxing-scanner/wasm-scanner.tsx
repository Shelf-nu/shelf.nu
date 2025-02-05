// app/components/scanner/wasm-scanner.tsx
import { useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link, useFetcher, useRouteLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { readBarcodes } from "zxing-wasm";
import type { ReadResult } from "zxing-wasm/reader";
import type { LayoutLoaderResponse } from "~/routes/_layout+/_layout";
import { initializeScanner } from "~/utils/barcode-scanner";
import { ShelfError } from "~/utils/error";
import { isQrId } from "~/utils/id";
import { tw } from "~/utils/tw";
import SuccessAnimation from "./success-animation";
import { Spinner } from "../shared/spinner";

type WasmScannerProps = {
  onQrDetectionSuccess?: (qrId: string, error?: string) => void | Promise<void>;
  videoMediaDevices?: MediaDeviceInfo[];
  isLoading?: boolean;
  backButtonText?: string;
  allowNonShelfCodes?: boolean;
  hideBackButtonText?: boolean;
  className?: string;
  overlayClassName?: string;
  paused?: boolean;
};

export const WasmScanner = ({
  videoMediaDevices,
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
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>();
  const [isInitializing, setIsInitializing] = useState(true);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  // Add containerRef to measure container dimensions
  const containerRef = useRef<HTMLDivElement>(null);

  const scannerCameraId = useRouteLoaderData<LayoutLoaderResponse>(
    "routes/_layout+/_layout"
  )?.scannerCameraId;

  const fetcher = useFetcher();

  // Initialize WASM and camera
  useEffect(() => {
    let animationFrame: number;
    let stream: MediaStream;

    const initScanner = async () => {
      try {
        // Initialize WASM module
        await initializeScanner();

        // Get available video devices
        const mediaDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = mediaDevices.filter(
          (d) => d.kind === "videoinput"
        );
        setDevices(videoDevices);

        // Set up camera stream
        await setupCamera();
        setIsInitializing(false);
        void processFrame();
      } catch (error) {
        console.error("Scanner initialization failed:", error);
        throw new ShelfError({
          message: "Failed to initialize scanner",
          cause: error,
          label: "QR",
        });
      }
    };

    // Enhanced camera setup with proper constraints
    const setupCamera = async () => {
      setIsCameraLoading(true);
      try {
        const constraints = {
          video: {
            deviceId: scannerCameraId ? { exact: scannerCameraId } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              updateCanvasSize();
            }
          };
        }
      } catch (error) {
        throw new ShelfError({
          message: "Camera access failed",
          cause: error,
          label: "QR",
        });
      } finally {
        setIsCameraLoading(false);
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
        // Get video's natural dimensions
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        const videoAspectRatio = videoWidth / videoHeight;

        // Get container dimensions
        const container = canvas.parentElement;
        const containerWidth = container?.clientWidth || 640;
        const containerHeight = container?.clientHeight || 480;

        // Calculate scaled dimensions (cover)
        let drawWidth = containerWidth;
        let drawHeight = containerWidth / videoAspectRatio;

        if (drawHeight < containerHeight) {
          drawHeight = containerHeight;
          drawWidth = containerHeight * videoAspectRatio;
        }

        // Set canvas dimensions to match container
        canvas.width = containerWidth;
        canvas.height = containerHeight;

        // Calculate centering offsets
        const offsetX = (containerWidth - drawWidth) / 2;
        const offsetY = (containerHeight - drawHeight) / 2;

        // Clear entire canvas
        ctx.clearRect(0, 0, containerWidth, containerHeight);

        // Draw video frame centered
        ctx.drawImage(
          video,
          0,
          0,
          videoWidth,
          videoHeight,
          offsetX,
          offsetY,
          drawWidth,
          drawHeight
        );

        // Get image data for QR detection - only from the drawn area
        const imageData = ctx.getImageData(
          0,
          0,
          containerWidth,
          containerHeight
        );

        // Attempt to read QR code
        const results = await readBarcodes(imageData, {
          tryHarder: true,
          formats: ["QRCode"],
          maxNumberOfSymbols: 1,
        });

        if (results.length > 0) {
          const result = results[0];
          // Adjust the box position relative to the centered video
          const adjustedPosition = {
            topLeft: {
              x: result.position.topLeft.x + offsetX,
              y: result.position.topLeft.y + offsetY,
            },
            topRight: {
              x: result.position.topRight.x + offsetX,
              y: result.position.topRight.y + offsetY,
            },
            bottomRight: {
              x: result.position.bottomRight.x + offsetX,
              y: result.position.bottomRight.y + offsetY,
            },
            bottomLeft: {
              x: result.position.bottomLeft.x + offsetX,
              y: result.position.bottomLeft.y + offsetY,
            },
          };
          drawDetectionBox(
            ctx,
            adjustedPosition,
            containerWidth,
            containerHeight
          );
          handleDetection(result.text);
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
      stream?.getTracks().forEach((track) => track.stop());
      resizeObserver.disconnect();
    };
  }, [scannerCameraId, paused]);

  // Simple box drawing function
  const drawDetectionBox = (
    ctx: CanvasRenderingContext2D,
    position: ReadResult["position"],
    canvasWidth: number,
    canvasHeight: number
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
    fetcher.submit(
      { scannerCameraId: deviceId },
      { method: "post", action: "/api/user/prefs/scanner-camera" }
    );
  };

  if (isInitializing || isCameraLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
        {isInitializing ? "Initializing scanner..." : "Loading camera..."}
      </div>
    );
  }

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
            <fetcher.Form
              method="post"
              action="/api/user/prefs/scanner-camera"
              onChange={(e) => fetcher.submit(e.currentTarget)}
            >
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
            </fetcher.Form>
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
