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

    const processFrame = async () => {
      if (!videoRef.current || !canvasRef.current || paused) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      try {
        // Get video's natural dimensions
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        const videoAspectRatio = videoWidth / videoHeight;

        // Get container dimensions (parent element)
        const container = canvas.parentElement;
        const containerWidth = container?.clientWidth || 640;
        const containerHeight = container?.clientHeight || 480;

        // Calculate scaled dimensions to maintain aspect ratio (cover)
        let drawWidth = containerWidth;
        let drawHeight = containerWidth / videoAspectRatio;

        // If the calculated height is too tall for containerHeight
        if (drawHeight > containerHeight) {
          drawHeight = containerHeight;
          drawWidth = containerHeight * videoAspectRatio;
        }

        // Center the video in the container
        const offsetX = (containerWidth - drawWidth) / 2;
        const offsetY = (containerHeight - drawHeight) / 2;

        // Set canvas dimensions to match video aspect ratio
        canvas.width = drawWidth;
        canvas.height = drawHeight;

        // Clear and draw video frame
        ctx.clearRect(0, 0, drawWidth, drawHeight);
        ctx.drawImage(
          video,
          0,
          0,
          videoWidth,
          videoHeight, // Source dimensions
          offsetX,
          offsetY,
          drawWidth,
          drawHeight // Destination dimensions
        );

        // Get image data from CENTERED video area
        const imageData = ctx.getImageData(0, 0, drawWidth, drawHeight);

        // Read barcodes from the properly scaled video frame
        const results = await readBarcodes(
          new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
          ),
          {
            tryHarder: true,
            formats: ["QRCode"],
            maxNumberOfSymbols: 1,
          }
        );

        const scale = {
          x: videoRef.current.offsetWidth / videoWidth,
          y: videoRef.current.offsetHeight / videoHeight,
        };

        if (results.length > 0) {
          handleDetection(results[0].text);
          drawBoundingBox(results[0].position, scale);
        }
      } catch (error) {
        console.error("Frame processing error:", error);
      }

      animationFrame = requestAnimationFrame(processFrame);
    };

    void initScanner();

    return () => {
      cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scannerCameraId, paused]);

  const handleDetection = (result: string) => {
    if (!result || incomingIsLoading) return;
    console.log(result);
    return;

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

  const drawBoundingBox = (
    position: ReadResult["position"] | undefined,
    scale: { x: number; y: number }
  ) => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = videoRef.current;
    if (!ctx || !position || !video) return;

    // Get actual video display dimensions
    const videoRect = video.getBoundingClientRect();

    // Calculate scaling factors based on rendered video size
    const renderedWidth = videoRect.width;
    const renderedHeight = videoRect.height;
    const scaleX = renderedWidth / video.videoWidth;
    const scaleY = renderedHeight / video.videoHeight;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#00ff00";

    // Adjust position points with actual rendered scaling
    const { topLeft, topRight, bottomRight, bottomLeft } = position;

    // Create adjusted points array
    const points = [
      { x: topLeft.x * scaleX, y: topLeft.y * scaleY },
      { x: topRight.x * scaleX, y: topRight.y * scaleY },
      { x: bottomRight.x * scaleX, y: bottomRight.y * scaleY },
      { x: bottomLeft.x * scaleX, y: bottomLeft.y * scaleY },
    ];

    // Draw polygon
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });

    ctx.closePath();
    ctx.stroke();
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
    <div className={tw("relative aspect-video size-full", className)}>
      <div className="relative size-full overflow-hidden rounded-lg">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="pointer-events-none size-full object-cover object-center"
          style={{ objectFit: "cover" }} // Explicit CSS fallback
        />
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 size-full"
          width={640}
          height={480}
        />
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
