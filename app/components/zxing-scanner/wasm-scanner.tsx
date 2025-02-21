import { useCallback, useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import Webcam from "react-webcam"; // Adjust import path as needed
import { ClientOnly } from "remix-utils/client-only";
import { tw } from "~/utils/tw";
import SuccessAnimation from "./success-animation";
import { processFrame, updateCanvasSize } from "./utils";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

type WasmScannerProps = {
  onQrDetectionSuccess: (qrId: string, error?: string) => void | Promise<void>;
  isLoading?: boolean;
  backButtonText?: string;
  allowNonShelfCodes?: boolean;
  hideBackButtonText?: boolean;
  className?: string;
  overlayClassName?: string;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  scanMessage?: string;
};

export const WasmScanner = ({
  onQrDetectionSuccess,
  backButtonText = "Back",
  allowNonShelfCodes = false,
  hideBackButtonText = false,
  className,
  overlayClassName,
  paused,
  setPaused,
  scanMessage,
}: WasmScannerProps) => {
  const videoRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrame = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);

  // Enumerate devices after requesting camera permission
  const enumerateDevicesWithPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());

      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = mediaDevices.filter(
        ({ kind }) => kind === "videoinput"
      );
      setDevices(videoDevices);

      const defaultDevice =
        videoDevices.find((d) => d.label.toLowerCase().includes("back")) ||
        videoDevices[0];
      setDeviceId(defaultDevice?.deviceId);
      setIsLoading(false);
    } catch (err) {
      setError(
        `Failed to access camera: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void enumerateDevicesWithPermission();
  }, [enumerateDevicesWithPermission]);

  // Start the animation loop when the video is ready
  useEffect(() => {
    const videoElement = videoRef.current?.video;
    const canvasElement = canvasRef.current;

    if (!videoElement || !canvasElement || isLoading) return;

    const handleMetadata = async () => {
      if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        await processFrame({
          video: videoElement,
          canvas: canvasElement,
          animationFrame,
          paused,
          setPaused,
          onQrDetectionSuccess,
          allowNonShelfCodes,
          setError,
        });
      }
    };

    videoElement.addEventListener("loadedmetadata", handleMetadata);
    return () => {
      videoElement.removeEventListener("loadedmetadata", handleMetadata);
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [
    deviceId, // Re-run when device changes
    isLoading, // Wait until loading is complete
    paused,
    onQrDetectionSuccess,
    allowNonShelfCodes,
  ]);

  // Stop the animation loop when paused
  useEffect(() => {
    if (paused && animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = 0;
    }
  }, [paused]);

  // Clean up on unmount
  useEffect(
    () => () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    },
    []
  );

  return (
    <div
      ref={containerRef}
      className={tw(
        "relative size-full min-h-[400px] overflow-hidden",
        className
      )}
    >
      <div className="relative size-full overflow-hidden">
        {error && error !== "" && (
          <InfoOverlay>
            <p className="mb-4">{error}</p>
            <p className="mb-4">
              If the issue persists, please contact support.
            </p>
            <Button
              onClick={() => window.location.reload()}
              variant="secondary"
            >
              Reload Page
            </Button>
          </InfoOverlay>
        )}

        {isLoading && (
          <InfoOverlay>
            <Initializing />
          </InfoOverlay>
        )}

        {!isLoading && deviceId && (
          <Webcam
            ref={videoRef}
            audio={false}
            videoConstraints={{
              deviceId: { exact: deviceId },
            }}
            onUserMediaError={(e) => {
              setError(`Camera error: ${e instanceof Error ? e.message : e}`);
              setIsLoading(false);
            }}
            onUserMedia={() => {
              const video = videoRef.current?.video;
              const canvas = canvasRef.current;
              if (!video || !canvas) {
                setError("Canvas or video element not found");
                setIsLoading(false);
                return;
              }
              updateCanvasSize({ video, canvas });
            }}
            className="pointer-events-none size-full object-cover"
          />
        )}

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
            {devices.length > 1 && (
              <select
                value={deviceId || ""}
                onChange={(e) => setDeviceId(e.target.value)}
                className="z-10 rounded border bg-white/10 p-1 text-sm text-white backdrop-blur-sm"
                aria-label="Select camera device"
              >
                {devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div
          className={tw(
            "absolute left-1/2 top-[75px] h-[400px] w-11/12 max-w-[600px] -translate-x-1/2 rounded border-4 border-white shadow-camera-overlay",
            overlayClassName
          )}
        >
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

// Assuming these are unchanged
function InfoOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/80 px-5">
      <div className="text-center text-white">{children}</div>
    </div>
  );
}

function Initializing() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setExpired(true), 10000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <>
      <Spinner className="mx-auto mb-2" />
      {expired
        ? "Camera initialization is taking longer than expected. Please reload the page"
        : "Initializing camera..."}
      {expired && (
        <div>
          <Button
            variant={"secondary"}
            onClick={() => window.location.reload()}
            className={"mt-4"}
          >
            Reload Page
          </Button>
        </div>
      )}
    </>
  );
}
