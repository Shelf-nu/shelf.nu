import { useCallback, useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { readBarcodes } from "zxing-wasm";
import type { ReadResult } from "zxing-wasm/reader";
import { isQrId } from "~/utils/id";
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

  /** Custom message to show when scanner is paused after detecting a code */
  scanMessage?: string;
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
  scanMessage,
}: WasmScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>();
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrame = useRef<number>(0);

  const handleDetection = useCallback(
    (result: string) => {
      if (!result || incomingIsLoading) return;
      // QR code validation logic...
      const regex = /^(https?:\/\/[^/]+\/(?:qr\/)?([a-zA-Z0-9]+))$/;
      const match = result.match(regex);

      if (!match && !allowNonShelfCodes) {
        void onQrDetectionSuccess?.(
          result,
          "Scanned code is not a valid Shelf QR code."
        );
        return;
      }

      // Vibrate on successful scan
      if (typeof navigator.vibrate === "function") {
        navigator.vibrate(200);
      }

      const qrId = match ? match[2] : result;
      if (match && !isQrId(qrId)) {
        void onQrDetectionSuccess?.(qrId, "Invalid QR code format");
        return;
      }
      void onQrDetectionSuccess?.(qrId);
    },
    [incomingIsLoading, allowNonShelfCodes, onQrDetectionSuccess]
  );

  const updateCanvasSize = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const videoRect = video.getBoundingClientRect();
    canvas.width = videoRect.width;
    canvas.height = videoRect.height;
  }, [videoRef, canvasRef]);

  const setupCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    const constraints = {
      video: selectedDevice
        ? { deviceId: { exact: selectedDevice } }
        : { facingMode: "environment" },
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = async () => {
        if (videoRef.current) {
          // Apply styles after metadata is loaded
          /** We had an issue where on first load the video would be distorted/stretched.
           * My current theory is that this was happning because the sizing by tailwind classes was set before the metadata was loaded.
           * This approach seems to resolve the issue(for now)
           */
          videoRef.current.style.objectFit = "cover";
          videoRef.current.style.width = "100%";
          videoRef.current.style.height = "100%";
          await videoRef.current.play();
          updateCanvasSize();
        }
      };
    }

    // Set initial device if not set
    if (!selectedDevice) {
      const activeTrack = stream.getVideoTracks()[0];
      const settings = activeTrack.getSettings();
      setSelectedDevice(settings.deviceId);
    }
  }, [selectedDevice, updateCanvasSize]);

  const processFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || paused) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    try {
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      // Make sure video dimensions are available because if they are not getImageData will error out
      console.log(videoWidth, videoHeight);

      canvas.width = videoWidth;
      canvas.height = videoHeight;
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

      const imageData = ctx.getImageData(0, 0, videoWidth, videoHeight);

      const results = await readBarcodes(imageData, {
        tryHarder: true,
        formats: ["QRCode"],
        maxNumberOfSymbols: 1,
      });

      if (results.length > 0) {
        const result = results[0];
        drawDetectionBox(ctx, result.position);
        void handleDetection(result.text);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Frame processing error:", error);
    }

    animationFrame.current = requestAnimationFrame(processFrame);
  }, [paused, handleDetection]);

  const initScanner = useCallback(async () => {
    await setupCamera();
    void processFrame();
  }, [setupCamera, processFrame]);

  // Create observer
  useEffect(() => {
    void initScanner();

    const resizeObserver = new ResizeObserver(updateCanvasSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      cancelAnimationFrame(animationFrame.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      resizeObserver.disconnect();
    };
  }, [initScanner, animationFrame, updateCanvasSize]);

  const drawDetectionBox = (
    ctx: CanvasRenderingContext2D,
    position: ReadResult["position"]
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
    const corners = [
      position.topLeft,
      position.topRight,
      position.bottomRight,
      position.bottomLeft,
    ];

    corners.forEach((corner) => {
      ctx.fillStyle = "red";
      ctx.fillRect(corner.x - 2, corner.y - 2, 4, 4);
    });
  };

  return (
    <div
      ref={containerRef}
      className={tw(
        "relative size-full min-h-[400px] overflow-hidden",
        className
      )}
    >
      <div className="relative size-full overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="pointer-events-none" // No classes as we handle scaling dynamically when camera is ready
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute left-0 top-0 size-full object-cover"
        />

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
              onChange={(e) => setSelectedDevice(e.target.value)}
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

        <div
          className={tw(
            "absolute left-1/2 top-[75px] h-[400px] w-11/12 max-w-[600px] -translate-x-1/2 rounded border-4 border-white shadow-camera-overlay",
            overlayClassName
          )}
        >
          {/* {true && ( */}
          {paused && (
            <div className="flex h-full flex-col items-center justify-center bg-white p-4 text-center">
              <h5>Code detected</h5>
              <ClientOnly fallback={null}>
                {() => <SuccessAnimation />}
              </ClientOnly>
              <p>{scanMessage || "Scanner paused"}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
