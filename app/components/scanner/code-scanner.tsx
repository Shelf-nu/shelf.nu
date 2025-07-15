import { useEffect, useRef, useState } from "react";
import type { BarcodeType } from "@prisma/client";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import { useAtom } from "jotai";
import lodash from "lodash";
import { Camera, CameraIcon, QrCode, ScanQrCode } from "lucide-react";
import Webcam from "react-webcam";
import { ClientOnly } from "remix-utils/client-only";
import { Tabs, TabsList, TabsTrigger } from "~/components/shared/tabs";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { tw } from "~/utils/tw";
import SuccessAnimation from "./success-animation";
import { handleDetection, processFrame, updateCanvasSize } from "./utils";
import { extractQrIdFromValue } from "../assets/assets-index/advanced-filters/helpers";
import { ErrorIcon } from "../errors";
import Input from "../forms/input";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";
import { scannerActionAtom } from "./drawer/action-atom";
import type { ActionType } from "./drawer/action-switcher";

export type OnCodeDetectionSuccessProps = {
  value: string; // The actual scanned value (QR ID or barcode value) - normalized for database operations
  type?: "qr" | "barcode"; // Code type - optional for backward compatibility
  error?: string;
  barcodeType?: BarcodeType; // Specific barcode type when type is "barcode"
};

export type OnCodeDetectionSuccess = ({
  value,
  type,
  error,
  barcodeType,
}: OnCodeDetectionSuccessProps) => void | Promise<void>;

// Legacy type aliases for backward compatibility
export type OnQrDetectionSuccessProps = OnCodeDetectionSuccessProps;
export type OnQRDetectionSuccess = OnCodeDetectionSuccess;

type CodeScannerProps = {
  onCodeDetectionSuccess: OnCodeDetectionSuccess;
  isLoading?: boolean;
  backButtonText?: string;
  allowNonShelfCodes?: boolean;
  hideBackButtonText?: boolean;
  className?: string;
  overlayClassName?: string;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** Custom message to show when scanner is paused after detecting a code */
  scanMessage?: string | React.ReactNode;

  /** Error message to show when scanner encounters an unsupported barcode */
  errorMessage?: string;

  /** Custom class for the scanner mode.
   * Can be a string or a function that receives the mode and returns a string
   */
  scannerModeClassName?: string | ((mode: Mode) => string);

  /** Custom callback for the scanner mode */
  scannerModeCallback?: (input: HTMLInputElement, paused: boolean) => void;

  actionSwitcher?: React.ReactNode;

  /** Force a specific mode and hide mode switching tabs */
  forceMode?: Mode;

  /** Control the overlay positioning for different contexts */
  overlayPosition?: "fullscreen" | "centered";
};

type Mode = "camera" | "scanner";

export const CodeScanner = ({
  onCodeDetectionSuccess,
  backButtonText = "Back",
  allowNonShelfCodes = false,
  hideBackButtonText = false,
  className,
  overlayClassName,
  paused,
  setPaused,
  scanMessage,
  errorMessage,

  scannerModeClassName,
  scannerModeCallback,

  actionSwitcher,
  forceMode,
  overlayPosition = "fullscreen",
}: CodeScannerProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const { isMd } = useViewportHeight();
  const containerRef = useRef<HTMLDivElement>(null);
  const [action] = useAtom(scannerActionAtom);

  const [mode, setMode] = useState<Mode>(
    forceMode || (isMd ? "scanner" : "camera")
  );

  const handleModeChange = (mode: Mode) => {
    // Don't allow mode changes if forceMode is set
    if (forceMode) return;

    if (mode === "camera") {
      setIsLoading(true);
      setMode(mode);
    } else {
      setMode(mode);
    }
  };

  // Determine if we should allow non-shelf codes based on the current action
  const shouldAllowNonShelfCodes =
    allowNonShelfCodes || action !== "View asset";

  return (
    <div
      ref={containerRef}
      className={tw(
        "relative size-full min-h-[400px] overflow-hidden",
        className
      )}
      data-mode={mode}
    >
      <div className="relative size-full overflow-hidden">
        {!forceMode && (
          <div className="absolute inset-x-0 top-0 z-30 flex w-full items-center justify-between bg-white px-4 py-2 text-gray-900">
            <div
              className={tw(
                // Different UI for mobile when actionSwitcher is present
                actionSwitcher &&
                  !isMd &&
                  "flex w-full items-center justify-between gap-4"
              )}
            >
              {!hideBackButtonText && (
                <Link
                  to=".."
                  className={tw(
                    "inline-flex items-center justify-start text-[11px] leading-[11px]",
                    actionSwitcher && isMd
                      ? "absolute bottom-[-20px] left-[2px] text-white"
                      : ""
                  )}
                >
                  <TriangleLeftIcon className="size-[14px]" />
                  <span>{backButtonText}</span>
                </Link>
              )}

              {actionSwitcher && <div>{actionSwitcher}</div>}
            </div>

            {/* We only show option to switch to scanner on big screens and when not forced to a specific mode */}
            {isMd && !forceMode && (
              <div>
                <Tabs
                  defaultValue={mode}
                  onValueChange={(mode) => handleModeChange(mode as Mode)}
                >
                  <TabsList>
                    <TabsTrigger value="scanner" disabled={isLoading || paused}>
                      <ScanQrCode className="mr-2 size-5" /> Scanner
                    </TabsTrigger>
                    <TabsTrigger value="camera" disabled={isLoading || paused}>
                      <CameraIcon className="mr-2 size-5" /> Camera
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <InfoOverlay>
            <Initializing />
          </InfoOverlay>
        )}

        {mode === "scanner" ? (
          <ScannerMode
            onCodeDetectionSuccess={onCodeDetectionSuccess}
            allowNonShelfCodes={shouldAllowNonShelfCodes}
            paused={paused}
            className={
              typeof scannerModeClassName === "function"
                ? scannerModeClassName(mode)
                : scannerModeClassName
            }
            callback={scannerModeCallback}
            action={action}
          />
        ) : (
          <CameraMode
            setIsLoading={setIsLoading}
            paused={paused}
            setPaused={setPaused}
            onCodeDetectionSuccess={onCodeDetectionSuccess}
            allowNonShelfCodes={shouldAllowNonShelfCodes}
            action={action}
          />
        )}
        {paused && (
          <div
            className={tw(
              "absolute left-1/2 -translate-x-1/2 rounded",
              overlayPosition === "fullscreen"
                ? "top-[75px] h-[400px] w-11/12 max-w-[600px]"
                : "top-1/2 max-h-[90%] w-11/12 max-w-[500px] -translate-y-1/2 overflow-y-auto md:max-h-[95%]",
              overlayClassName
            )}
          >
            <div
              className={tw(
                "flex flex-col items-center rounded bg-white p-4 shadow-md",
                overlayPosition === "fullscreen" ? "h-full justify-center text-center" : "min-h-[200px]",
                // Use different alignment based on content type
                typeof scanMessage === "string" || !scanMessage ? "justify-center text-center" : "justify-start text-left"
              )}
            >
              {errorMessage ? (
                <>
                  <span className="mb-5 size-14 text-primary">
                    <ErrorIcon />
                  </span>
                  <h5 className="mb-2">Unsupported Barcode detected</h5>
                  <p className="mb-4 max-w-[300px] text-red-600">
                    {errorMessage}
                  </p>
                  <Button
                    onClick={() => setPaused(false)}
                    variant="secondary"
                    className="mt-2"
                  >
                    Scan again
                  </Button>
                </>
              ) : (
                <>
                  <h5>Code detected</h5>

                  {typeof scanMessage === "string" ? (
                    <>
                      <ClientOnly fallback={null}>
                        {() => <SuccessAnimation />}
                      </ClientOnly>
                      <p>{scanMessage || "Scanner paused"}</p>
                    </>
                  ) : (
                    scanMessage || <p>Scanner paused</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function ScannerMode({
  onCodeDetectionSuccess,
  allowNonShelfCodes = false,
  paused,
  className,
  callback,
}: {
  onCodeDetectionSuccess: OnCodeDetectionSuccess;
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
  action?: ActionType;
}) {
  const [inputIsFocused, setInputIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedHandleInputChange = lodash.debounce(
    async (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const input = e.target as HTMLInputElement;
      const result = extractQrIdFromValue(input.value);
      await handleDetection({
        result,
        onCodeDetectionSuccess,
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
        "flex h-full flex-col items-center justify-center bg-slate-800 text-center ",
        className
      )}
    >
      <RadialBg />
      {/* Pulsating QR Icon */}
      <div className="relative mx-auto mb-4 size-16">
        <div className="absolute inset-0 flex items-center justify-center">
          <QrCode className="size-8  text-white/90" />
        </div>
        <div className="animate-ping absolute inset-0 rounded-full border-4 text-white/80 opacity-30"></div>
      </div>
      <Input
        ref={inputRef}
        autoFocus
        className="items-center [&_.inner-label]:font-normal [&_.inner-label]:text-white"
        inputClassName="scanner-mode-input max-w-[460px] min-w-[360px]"
        disabled={paused}
        name="code"
        label={
          paused
            ? "Scanner paused"
            : inputIsFocused
            ? "Waiting for scan..."
            : "Please click on the text field before scanning"
        }
        icon={inputIsFocused ? "qr-code" : "mouse-pointer-click"}
        iconClassName={tw("text-gray-600", !inputIsFocused && "animate-bounce")}
        onChange={debouncedHandleInputChange}
        onFocus={() => setInputIsFocused(true)}
        onBlur={() => setInputIsFocused(false)}
      />
      <p className="mt-4 max-w-[360px] text-white/70">
        Focus the field and use your barcode scanner to scan any Shelf QR code.
      </p>
    </div>
  );
}

function CameraMode({
  setIsLoading,
  paused,
  setPaused,
  onCodeDetectionSuccess,
  allowNonShelfCodes = false,
}: {
  setIsLoading: (loading: boolean) => void;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  onCodeDetectionSuccess: OnCodeDetectionSuccess;
  allowNonShelfCodes: boolean;
  action?: ActionType;
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
            onCodeDetectionSuccess,
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
  }, [allowNonShelfCodes, onCodeDetectionSuccess, paused, setPaused]);

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
              onCodeDetectionSuccess,
              allowNonShelfCodes,
              setError,
            });
          }
        };
        void handleMetadata();
      }
    }
  }, [paused, allowNonShelfCodes, onCodeDetectionSuccess, setPaused]);

  return (
    <>
      {/* Error State Overlay */}
      {error && error !== "" && (
        <InfoOverlay>
          <div className="mx-auto mb-6 flex size-32 items-center justify-center rounded-lg border-2 border-dashed border-white/30">
            <Camera className="size-12 text-white/50" />
          </div>
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
    <div className="info-overlay absolute inset-0 z-20 flex items-center justify-center bg-slate-800 px-5">
      <RadialBg />
      <div className="z-10 text-center text-white">{children}</div>
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
      <div className="mx-auto mb-6 flex size-32 items-center justify-center rounded-lg border-2 border-dashed border-white/30">
        <Camera className="size-12 text-white/50" />
      </div>
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

function RadialBg() {
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.3)_0,rgba(59,130,246,0)_50%)]"></div>
      <div className="absolute inset-0  bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.2)_0,rgba(59,130,246,0)_70%)] "></div>
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48Y2lyY2xlIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIgY3g9IjEwIiBjeT0iMTAiIHI9IjEiLz48L2c+PC9zdmc+')] opacity-30"></div>
    </div>
  );
}

export function useGlobalModeViaObserver(): Mode {
  /** Observer to watch for changes in the data-mode attribute */
  const { isMd } = useViewportHeight();
  const [mode, setMode] = useState<Mode>(isMd ? "scanner" : "camera");
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    // First, check the current state when the component mounts
    const targetNode = document.querySelector("div[data-mode]");
    if (targetNode) {
      const currentMode = targetNode.getAttribute("data-mode") as Mode | null;
      if (currentMode) {
        setMode(currentMode);
      }

      // Then set up the observer for future changes
      const config: MutationObserverInit = {
        attributes: true,
        attributeFilter: ["data-mode"],
      };

      const callback: MutationCallback = (mutations) => {
        mutations.forEach((mutation) => {
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === "data-mode"
          ) {
            const dataMode = targetNode.getAttribute("data-mode");
            if (dataMode) {
              setMode(dataMode as Mode);
            }
          }
        });
      };

      observerRef.current = new MutationObserver(callback);
      observerRef.current.observe(targetNode, config);

      return () => {
        if (observerRef.current) {
          observerRef.current.disconnect();
        }
      };
    }
  }, []); // Empty dependency array to run only on mount

  return mode;
}
