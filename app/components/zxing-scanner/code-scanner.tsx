import { useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import lodash from "lodash";
import Webcam from "react-webcam";
import { ClientOnly } from "remix-utils/client-only";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { tw } from "~/utils/tw";
import SuccessAnimation from "./success-animation";
import { handleDetection, processFrame, updateCanvasSize } from "./utils";
import { extractQrIdFromValue } from "../assets/assets-index/advanced-filters/helpers";
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

  /** Custom class for the scanner mode */
  scannerModeClassName?: string;

  /** Custom callback for the scanner mode */
  scannerModeCallback?: (input: HTMLInputElement, paused: boolean) => void;
};

type Mode = "camera" | "scanner";

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

  scannerModeClassName,
  scannerModeCallback,
}: CodeScannerProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const { isMd } = useViewportHeight();
  const containerRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>(isMd ? "scanner" : "camera");

  const handleModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === "camera") {
      setIsLoading(true);
      setMode(e.target.value as Mode);
    } else {
      setMode(e.target.value as Mode);
    }
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

          {/* We only show option to switch to scanner on big screens. Its not possible on mobile */}
          {isMd && (
            <div>
              <select
                value={mode}
                onChange={handleModeChange}
                className={tw(
                  "z-10 rounded border  py-1 text-sm  backdrop-blur-sm",
                  "bg-black/20 text-white"
                )}
                disabled={isLoading || paused}
              >
                <option value="camera" className="p-1 text-black">
                  Mode: camera
                </option>
                <option value="scanner" className="p-1 text-black">
                  Mode: Barcode scanner
                </option>
              </select>
            </div>
          )}
        </div>

        {isLoading && (
          <InfoOverlay>
            <Initializing />
          </InfoOverlay>
        )}

        {mode === "scanner" ? (
          <ScannerMode
            onQrDetectionSuccess={onQrDetectionSuccess}
            allowNonShelfCodes={allowNonShelfCodes}
            paused={paused}
            className={scannerModeClassName}
            callback={scannerModeCallback}
          />
        ) : (
          <CameraMode
            setIsLoading={setIsLoading}
            paused={paused}
            setPaused={setPaused}
            onQrDetectionSuccess={onQrDetectionSuccess}
            allowNonShelfCodes={allowNonShelfCodes}
          />
        )}
        {paused && (
          <div
            className={tw(
              "absolute left-1/2 top-[75px] h-[400px] w-11/12 max-w-[600px] -translate-x-1/2 rounded ",
              overlayClassName
            )}
          >
            <div className="flex h-full flex-col items-center justify-center rounded bg-white p-4 text-center shadow-md">
              <h5>Code detected</h5>
              <ClientOnly fallback={null}>
                {() => <SuccessAnimation />}
              </ClientOnly>
              <p>{scanMessage || "Scanner paused"}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function ScannerMode({
  onQrDetectionSuccess,
  allowNonShelfCodes = false,
  paused,
  className,
  callback,
}: {
  onQrDetectionSuccess: (qrId: string) => void;
  allowNonShelfCodes: boolean;
  paused: boolean;
  className?: string;
  /**
   * Optional callback to pass.
   * Will run after handleDetection
   * Receives the input element as argument
   * By default if not passed, input element will always be cleared after handleDetection
   * */
  callback?: (input: HTMLInputElement, paused: boolean) => void;
}) {
  const [inputIsFocused, setInputIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedHandleInputChange = lodash.debounce(
    async (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const input = e.target as HTMLInputElement;
      const result = extractQrIdFromValue(input.value);
      await handleDetection({
        result,
        onQrDetectionSuccess,
        allowNonShelfCodes,
        paused,
      });

      // Run the callback if passed
      if (callback) {
        callback(input, paused);
      } else {
        /** Clean up the input */
        input.value = "";
      }
    },
    300
  );

  return (
    <div
      className={tw(
        "flex h-full flex-col items-center bg-gray-600 pt-[20px] text-center",
        className
      )}
    >
      <Input
        ref={inputRef}
        autoFocus
        className="items-center [&_.inner-label]:font-normal [&_.inner-label]:text-white"
        inputClassName="scanner-mode-input max-w-[260px]"
        disabled={paused}
        name="code"
        label={
          paused
            ? "Scanner paused"
            : inputIsFocused
            ? "Waiting for scan..."
            : "Please click on the text field before scanning"
        }
        onChange={debouncedHandleInputChange}
        onFocus={() => setInputIsFocused(true)}
        onBlur={() => setInputIsFocused(false)}
      />
      <p className="mt-4 max-w-[260px] text-white/70">
        Focus the field and use your barcode scanner to scan any Shelf QR code.
      </p>
    </div>
  );
}

function CameraMode({
  setIsLoading,
  paused,
  setPaused,
  onQrDetectionSuccess,
  allowNonShelfCodes = false,
}: {
  setIsLoading: (loading: boolean) => void;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  onQrDetectionSuccess: (qrId: string) => void;
  allowNonShelfCodes: boolean;
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

          /** Error when there is no video element.  */
          if (!video || !canvas) {
            setError("Canvas or video element not found");
            setIsLoading(false);
            return;
          }

          /** ONce the video can play, update canvas and stop the loading */
          video.addEventListener("canplay", () => {
            updateCanvasSize({ video, canvas });
            setIsLoading(false);
          });

          video.addEventListener("error", (e) => {
            setError(
              `Error playing video: ${e instanceof Error ? e.message : e}`
            );
            setIsLoading(false);
          });
        }}
        className="pointer-events-none size-full object-cover"
      />

      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute left-0 top-0 size-full object-cover"
      />
    </>
  );
}

function InfoOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="info-overlay absolute inset-0 z-20 flex items-center justify-center bg-gray-900/80 px-5">
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
