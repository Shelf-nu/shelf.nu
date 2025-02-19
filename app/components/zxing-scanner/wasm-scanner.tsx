import { useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { tw } from "~/utils/tw";
import SuccessAnimation from "./success-animation";
import { getBestBackCamera, processFrame, setupCamera } from "./utils";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

type WasmScannerProps = {
  onQrDetectionSuccess: (qrId: string, error?: string) => void | Promise<void>;
  devices: MediaDeviceInfo[];
  isLoading?: boolean;
  backButtonText?: string;
  allowNonShelfCodes?: boolean;
  hideBackButtonText?: boolean;
  className?: string;
  overlayClassName?: string;
  paused: boolean;
  setPaused: (paused: boolean) => void;

  /** Custom message to show when scanner is paused after detecting a code */
  scanMessage?: string;
};

export const WasmScanner = ({
  devices,
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedDevice, setSelectedDevice] = useState<
    string | null | undefined
  >();
  const animationFrame = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const setupCameraAsync = async () => {
      await setupCamera({
        videoRef,
        canvasRef,
        toggleLoading: setIsLoading,
        selectedDevice,
        setError,
      });
    };

    void setupCameraAsync();
  }, [videoRef, canvasRef, selectedDevice]);

  useEffect(() => {
    const processFrameAsync = async () => {
      await processFrame({
        videoRef,
        canvasRef,
        animationFrame,
        paused,
        setPaused,
        onQrDetectionSuccess,
        allowNonShelfCodes,
      });
    };

    void processFrameAsync();
  }, [
    videoRef,
    canvasRef,
    animationFrame,
    paused,
    setPaused,
    onQrDetectionSuccess,
    allowNonShelfCodes,
  ]);

  useEffect(
    () => () => {
      // Cleanup to prevent memory leaks
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    },
    [animationFrame]
  );

  // Initialize default device selection
  useEffect(() => {
    if (devices.length > 0 && !selectedDevice) {
      // Find first device with environment facing mode (if available)
      const environmentDevice = getBestBackCamera(devices);
      setSelectedDevice(environmentDevice?.deviceId || devices[0]?.deviceId);
    }
  }, [devices, selectedDevice]);
  // This ccould be a good improvement
  // useEffect(() => {
  //   async function playVideo() {
  //     if (paused) {
  //       videoRef.current?.pause();
  //     } else {
  //       await videoRef.current?.play();
  //     }
  //   }

  //   void playVideo();
  // }, [paused]);

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

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="pointer-events-none size-full object-cover"
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
              value={selectedDevice || devices[0]?.deviceId}
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

function InfoOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/80 px-5">
      <div className="text-center text-white ">{children}</div>
    </div>
  );
}

/**
 * Visible while camera is loading
 * Displays a spinner and a message
 * If the process takes more than 10 seconds we can safely assume something went wrong and we give the user the option to reload the page
 */
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
            Reload page
          </Button>
        </div>
      )}
    </>
  );
}
