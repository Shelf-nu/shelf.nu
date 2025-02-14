import { useCallback, useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { readBarcodes } from "zxing-wasm";
import type { ReadResult } from "zxing-wasm/reader";
import { isQrId } from "~/utils/id";
import { tw } from "~/utils/tw";
import SuccessAnimation from "./success-animation";
import { getBestBackCamera } from "./utils";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

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

  /**
   * If true, scanner will continue processing after successful detection
   * If false (default), scanner will cleanup and stop after successful detection
   */
  continuousScanning?: boolean;

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
  continuousScanning = false,
}: WasmScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>();
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrame = useRef<number>(0);
  // Processing ref to prevent multiple detections
  const isProcessingRef = useRef<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isInitializing = useRef(true);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Cleanup function to stop all ongoing processes and release camera
   */
  const cleanup = useCallback(() => {
    // Cancel any pending animation frames
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = 0;
    }

    // Stop and remove all tracks from the stream
    if (streamRef.current) {
      const tracks = streamRef.current.getTracks();
      tracks.forEach((track) => {
        track.stop();
        streamRef.current?.removeTrack(track);
      });
      streamRef.current = null;
    }

    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleDetection = useCallback(
    async (result: string) => {
      if (!result || incomingIsLoading || isProcessingRef.current) return;

      isProcessingRef.current = true;

      try {
        const regex = /^(https?:\/\/[^/]+\/(?:qr\/)?([a-zA-Z0-9]+))$/;
        const match = result.match(regex);

        if (!match && !allowNonShelfCodes) {
          await onQrDetectionSuccess?.(
            result,
            "Scanned code is not a valid Shelf QR code."
          );
          return;
        }

        if (typeof navigator.vibrate === "function") {
          navigator.vibrate(200);
        }

        const qrId = match ? match[2] : result;
        if (match && !isQrId(qrId)) {
          await onQrDetectionSuccess?.(qrId, "Invalid QR code format");
          return;
        }

        // Only cleanup if not in continuous scanning mode
        if (!continuousScanning) {
          cleanup();
        }

        await onQrDetectionSuccess?.(qrId);
      } finally {
        isProcessingRef.current = false;
      }
    },
    [
      incomingIsLoading,
      allowNonShelfCodes,
      onQrDetectionSuccess,
      cleanup,
      continuousScanning,
    ]
  );

  const updateCanvasSize = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }, []);

  const setupCamera = useCallback(async () => {
    try {
      setIsLoading(true);
      const currentVideoTrack = streamRef.current?.getVideoTracks()[0];
      // Skip redundant initialization
      if (
        currentVideoTrack?.readyState === "live" &&
        currentVideoTrack?.getSettings().deviceId === selectedDevice
      ) {
        return;
      }

      // Cleanup previous stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const constraints = selectedDevice
        ? { deviceId: { exact: selectedDevice } }
        : { facingMode: "environment" };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: constraints,
        audio: false,
      });

      // Handle component unmount while waiting for camera
      if (!videoRef.current) return;

      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      // Wait for video to be ready
      await new Promise((resolve) => {
        videoRef.current!.onloadedmetadata = resolve;
      });

      await videoRef.current.play();
      updateCanvasSize();

      // First initialization only
      if (isInitializing.current) {
        const track = stream.getVideoTracks()[0];
        setSelectedDevice(track.getSettings().deviceId);
        isInitializing.current = false;
      }
    } catch (error) {
      setError(
        `Camera error: ${error instanceof Error ? error.message : error}`
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedDevice, updateCanvasSize]);

  const processFrame = useCallback(async () => {
    if (
      !videoRef.current ||
      !canvasRef.current ||
      paused ||
      isProcessingRef.current
    ) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    try {
      // Check if video is actually playing and has valid dimensions
      if (
        video.readyState !== video.HAVE_ENOUGH_DATA ||
        !video.videoWidth ||
        !video.videoHeight
      ) {
        animationFrame.current = requestAnimationFrame(processFrame);
        return;
      }
      console.log("Video dimensions:", video.videoWidth, video.videoHeight);
      console.log("Canvas dimensions:", canvas.width, canvas.height);
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      canvas.width = videoWidth;
      canvas.height = videoHeight;
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

      const imageData = ctx.getImageData(0, 0, videoWidth, videoHeight);

      const results = await readBarcodes(imageData, {
        tryHarder: true,
        formats: ["QRCode"],
        maxNumberOfSymbols: 1,
      });

      if (results.length > 0 && !isProcessingRef.current) {
        const result = results[0];
        drawDetectionBox(ctx, result.position);
        void handleDetection(result.text);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Frame processing error:", error);
    }

    // Always request next frame unless paused
    if (!paused) {
      animationFrame.current = requestAnimationFrame(processFrame);
    }
  }, [paused, handleDetection]);

  // Simplified initialization flow
  useEffect(() => {
    const abortController = new AbortController();

    const init = async () => {
      await setupCamera();
      if (!abortController.signal.aborted && !paused) {
        animationFrame.current = requestAnimationFrame(processFrame);
      }
    };

    void init();
    const resizeObserver = new ResizeObserver(updateCanvasSize);

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      abortController.abort();
      cleanup();
      resizeObserver.disconnect();
    };
  }, [setupCamera, processFrame, paused, cleanup, updateCanvasSize]);

  // Handle device selection changes
  useEffect(() => {
    if (selectedDevice) {
      const initCamera = async () => {
        isInitializing.current = true;
        await setupCamera();
        if (!paused) {
          animationFrame.current = requestAnimationFrame(processFrame);
        }
      };
      void initCamera();
    }
  }, [paused, processFrame, selectedDevice, setupCamera]);

  // Initialize default device selection
  useEffect(() => {
    if (devices.length > 0 && !selectedDevice) {
      // Find first device with environment facing mode (if available)
      const environmentDevice = getBestBackCamera(devices);
      setSelectedDevice(environmentDevice?.deviceId || devices[0]?.deviceId);
    }
  }, [devices, selectedDevice]);

  const handleDeviceChange = (deviceId: string) => {
    // cleanup(); // Explicit cleanup before switch
    isInitializing.current = true;
    setSelectedDevice(deviceId);
  };

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
        {/* Error State Overlay */}
        {error && error !== "" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/80 px-5">
            <div className="text-center text-white">
              <p className="mb-4">{error}</p>
              <p className="mb-4">
                If the issue persists, please contact support.
              </p>
              <Button
                onClick={() => window.location.reload()}
                variant="secondary"
              >
                Refresh Page
              </Button>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/80">
            <div className="text-center text-white ">
              <Spinner className="mx-auto mb-2" />
              Initializing camera...
            </div>
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="pointer-events-none size-full object-cover" // No classes as we handle scaling dynamically when camera is ready
          onError={(e) => {
            setError(`Video error: ${e.currentTarget.error?.message}`);
            setIsLoading(false);
          }}
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
