import { useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import Webcam from "react-webcam";
import { ClientOnly } from "remix-utils/client-only";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { tw } from "~/utils/tw";
import SuccessAnimation from "./success-animation";
import { processFrame, updateCanvasSize } from "./utils";
import Input from "../forms/input";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

type CodeScannerProps = {
  onQrDetectionSuccess: (qrId: string, error?: string) => void | Promise<void>;
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

export const CodeScanner = ({
  onQrDetectionSuccess,
  backButtonText = "Back",
  allowNonShelfCodes = false,
  hideBackButtonText = false,
  className,
  overlayClassName,
  paused,
  setPaused,
  scanMessage,
}: CodeScannerProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const { isMd } = useViewportHeight();
  const containerRef = useRef<HTMLDivElement>(null);

  // @TODO: default mode
  const [mode, setMode] = useState<"camera" | "scanner">(
    isMd ? "scanner" : "camera"
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
        <div className="absolute inset-x-0 top-0 z-30 flex w-full items-center justify-between bg-transparent text-white">
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
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className={tw(
                "z-10 rounded border bg-white/10 p-1 text-sm  backdrop-blur-sm",
                mode === "scanner" ? "text-black" : "text-white"
              )}
            >
              <option value="camera" className="p-1 text-black">
                Mode: camera
              </option>
              <option value="scanner" className="p-1 text-black">
                Mode: Scanner
              </option>
            </select>
          </div>
        </div>

        {isLoading && (
          <InfoOverlay>
            <Initializing />
          </InfoOverlay>
        )}

        {mode === "scanner" ? (
          <ScannerMode />
        ) : (
          <CameraMode
            setIsLoading={setIsLoading}
            overlayClassName={overlayClassName}
            paused={paused}
            scanMessage={scanMessage}
            setPaused={setPaused}
            onQrDetectionSuccess={onQrDetectionSuccess}
            allowNonShelfCodes={allowNonShelfCodes}
          />
        )}
      </div>
    </div>
  );
};

function ScannerMode({}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleBlur = () => {
    inputRef?.current?.focus();
  };

  return (
    <div className="flex flex-col items-center pt-[10px] text-center">
      <p>Waiting for scan...</p>
      <Input autoFocus name="code" label="code" hideLabel onBlur={handleBlur} />
    </div>
  );
}

function CameraMode({
  setIsLoading,
  overlayClassName,
  paused,
  scanMessage,
  setPaused,
  onQrDetectionSuccess,
  allowNonShelfCodes,
}: {
  setIsLoading: (loading: boolean) => void;
  overlayClassName?: string;
  paused: boolean;
  scanMessage?: string;
  setPaused: (paused: boolean) => void;
  onQrDetectionSuccess: (qrId: string) => void;
  allowNonShelfCodes?: boolean;
}) {
  const videoRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrame = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Start the animation loop when the video starts playing
  useEffect(() => {
    const videoElement = videoRef.current?.video;
    const canvasElement = canvasRef.current;
    if (videoElement && canvasElement) {
      const handleMetadata = async () => {
        // Video metadata is loaded, safe to start capturing
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
      };
    }
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [allowNonShelfCodes, onQrDetectionSuccess, paused, setPaused]);

  // Effect to handle pause and resume
  useEffect(() => {
    if (paused) {
      // Cancel the animation frame when paused
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = 0;
      }
    } else {
      // Start processing frames when unpaused
      const videoElement = videoRef.current?.video;
      const canvasElement = canvasRef.current;
      if (videoElement && canvasElement) {
        const handleMetadata = async () => {
          // Video metadata is loaded, safe to start capturing
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
        void handleMetadata();
      }
    }
  }, [paused, allowNonShelfCodes, onQrDetectionSuccess, setPaused]);
  return (
    <>
      {/* Error State Overlay */}
      {error && error !== "" && (
        <InfoOverlay>
          <p className="mb-4">{error}</p>
          <p className="mb-4">If the issue persists, please contact support.</p>
          <Button onClick={() => window.location.reload()} variant="secondary">
            Reload Page
          </Button>
        </InfoOverlay>
      )}
      <Webcam
        ref={videoRef}
        audio={false}
        videoConstraints={{ facingMode: "environment" }}
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
          setIsLoading(false);
        }}
        className="pointer-events-none size-full object-cover"
      />

      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute left-0 top-0 size-full object-cover"
      />

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
    </>
  );
}

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
