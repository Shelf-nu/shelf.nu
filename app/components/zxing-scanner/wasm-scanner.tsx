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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import Icon from "../icons/icon";
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
  const containerRef = useRef<HTMLDivElement>(null);

  // States for managing camera and scanner
  const [isInitializing, setIsInitializing] = useState(true);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get the saved camera ID from route loader
  const scannerCameraId = useRouteLoaderData<LayoutLoaderResponse>(
    "routes/_layout+/_layout"
  )?.scannerCameraId;

  const fetcher = useFetcher();
  const isSwitchingCamera = fetcher.state === "submitting";

  // Initialize WASM and request camera permissions
  useEffect(() => {
    const initScanner = async () => {
      try {
        setError(null);
        // Initialize WASM module
        await initializeScanner();

        // Setup camera with saved preference
        if (scannerCameraId) {
          await setupCamera(scannerCameraId);
        } else if (videoMediaDevices && videoMediaDevices.length > 0) {
          await setupCamera(videoMediaDevices[0].deviceId);
        }

        setIsInitializing(false);
      } catch (err) {
        console.error("Scanner initialization failed:", err);
        setError(
          "Failed to access camera. Please try another camera or check your permissions."
        );
        setIsInitializing(false);
      }
    };

    void initScanner();
  }, [scannerCameraId, videoMediaDevices]);

  // Camera setup function
  const setupCamera = async (deviceId: string) => {
    setIsCameraLoading(true);
    setError(null);

    try {
      // Stop any existing streams first
      if (videoRef.current?.srcObject) {
        const existingStream = videoRef.current.srcObject as MediaStream;
        existingStream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (!videoRef.current) {
        throw new Error("Video element not initialized");
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // Start frame processing only after successful camera setup
      void processFrame();

      // Update camera preference via form submission
      const formData = new FormData();
      formData.append("scannerCameraId", deviceId);
      fetcher.submit(formData, {
        method: "post",
        action: "/api/user/prefs/scanner-camera",
      });
    } catch (error) {
      console.error("Camera setup failed:", error);
      setError(
        "Failed to access camera. Please try another camera or check your permissions."
      );
      throw new ShelfError({
        message: "Camera access failed",
        cause: error,
        label: "QR",
      });
    } finally {
      setIsCameraLoading(false);
    }
  };

  // Frame processing for QR detection
  const processFrame = async () => {
    if (!videoRef.current || !canvasRef.current || paused) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    try {
      // Get video dimensions
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      const videoAspectRatio = videoWidth / videoHeight;

      // Get container dimensions
      const container = containerRef.current;
      const containerWidth = container?.clientWidth || 640;
      const containerHeight = container?.clientHeight || 480;

      // Calculate dimensions to maintain aspect ratio
      let drawWidth = containerWidth;
      let drawHeight = containerWidth / videoAspectRatio;

      if (drawHeight < containerHeight) {
        drawHeight = containerHeight;
        drawWidth = containerHeight * videoAspectRatio;
      }

      // Update canvas size
      canvas.width = containerWidth;
      canvas.height = containerHeight;

      // Center the video frame
      const offsetX = (containerWidth - drawWidth) / 2;
      const offsetY = (containerHeight - drawHeight) / 2;

      // Clear and draw frame
      ctx.clearRect(0, 0, containerWidth, containerHeight);
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

      // Get image data for QR scanning
      const imageData = ctx.getImageData(0, 0, containerWidth, containerHeight);

      // Scan for QR codes
      const results = await readBarcodes(imageData, {
        tryHarder: true,
        formats: ["QRCode"],
        maxNumberOfSymbols: 1,
      });

      // Process results
      if (results.length > 0) {
        const result = results[0];
        drawDetectionBox(
          ctx,
          {
            ...result.position,
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
          },
          containerWidth,
          containerHeight
        );

        void handleDetection(result.text);
      }
    } catch (error) {
      console.error("Frame processing error:", error);
    }

    // Continue processing frames
    requestAnimationFrame(processFrame);
  };

  // Draw detection box around QR code
  const drawDetectionBox = (
    ctx: CanvasRenderingContext2D,
    position: ReadResult["position"],
    canvasWidth: number,
    canvasHeight: number
  ) => {
    if (!position) return;

    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#22c55e";
    ctx.moveTo(position.topLeft.x, position.topLeft.y);
    ctx.lineTo(position.topRight.x, position.topRight.y);
    ctx.lineTo(position.bottomRight.x, position.bottomRight.y);
    ctx.lineTo(position.bottomLeft.x, position.bottomLeft.y);
    ctx.closePath();
    ctx.stroke();
  };

  // Handle QR code detection
  const handleDetection = (result: string) => {
    if (!result || incomingIsLoading) return;

    const regex = /^(https?:\/\/[^/]+\/(?:qr\/)?([a-zA-Z0-9]+))$/;
    const match = result.match(regex);

    if (!match && !allowNonShelfCodes) {
      void onQrDetectionSuccess?.(
        result,
        "Scanned code is not a valid Shelf QR code."
      );
      return;
    }

    // Provide haptic feedback
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(200);
    }

    const qrId = match ? match[2] : result;
    if (match && !isQrId(qrId)) {
      void onQrDetectionSuccess?.(qrId, "Invalid QR code format");
      return;
    }

    void onQrDetectionSuccess?.(qrId);
  };

  // Loading states
  if (isInitializing || isCameraLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
        {isInitializing ? "Initializing scanner..." : "Loading camera..."}
      </div>
    );
  }

  // Show loading state while initializing
  if (isInitializing) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
        Initializing scanner...
      </div>
    );
  }

  // Show error state with retry option
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-sm text-gray-700">{error}</p>
        {videoMediaDevices && videoMediaDevices.length > 1 && (
          <div className="text-sm text-gray-500">
            Available cameras:
            <div className="mt-2 flex flex-col gap-2">
              {videoMediaDevices.map((device, index) => (
                <button
                  key={device.deviceId}
                  onClick={() => {
                    setError(null);
                    void setupCamera(device.deviceId);
                  }}
                  className="rounded-md bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200"
                >
                  {device.label || `Camera ${index + 1}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Show loading state while switching camera
  if (isCameraLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
        Loading camera...
      </div>
    );
  }

  return (
    <div ref={containerRef} className={tw("scanner-container", className)}>
      <div className="relative size-full overflow-hidden rounded-lg">
        {/* Video and Canvas Elements */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="pointer-events-none size-full object-cover"
        />
        <canvas ref={canvasRef} className="canvas-overlay size-full" />

        {/* Controls Overlay */}
        <div className="absolute inset-x-0 top-0 z-10 flex w-full items-center justify-between bg-transparent text-white">
          {/* Back Button */}
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

          {/* Camera Selector */}
          <div>
            <fetcher.Form
              method="post"
              action="/api/user/prefs/scanner-camera"
              onChange={(e) => fetcher.submit(e.currentTarget)}
            >
              {videoMediaDevices && videoMediaDevices.length > 0 && (
                <Select name="scannerCameraId" defaultValue={scannerCameraId}>
                  <SelectTrigger
                    hideArrow
                    className="z-10 size-12 overflow-hidden rounded-full border-none bg-transparent pb-1 text-gray-25/50 focus:border-none focus:ring-0 focus:ring-offset-0"
                  >
                    <SelectValue placeholder={<Icon icon="settings" />}>
                      <Icon icon="settings" />
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    alignOffset={10}
                    className="mt-1 max-w-96 md:min-w-80"
                  >
                    {videoMediaDevices.map((device, index) => (
                      <SelectItem
                        key={device.deviceId}
                        value={device.deviceId}
                        className="cursor-pointer"
                      >
                        {device.label || `Camera ${index + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </fetcher.Form>
          </div>
        </div>

        {/* Scanning Overlay */}
        <div
          className={tw(
            "absolute left-1/2 top-[75px] h-[400px] w-11/12 max-w-[600px] -translate-x-1/2 rounded border-4 border-white shadow-camera-overlay before:absolute before:bottom-3 before:left-1/2 before:h-1 before:w-[calc(100%-40px)] before:-translate-x-1/2 before:rounded-full before:bg-white md:h-[600px]",
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
