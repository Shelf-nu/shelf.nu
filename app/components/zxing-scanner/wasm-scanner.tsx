// app/components/scanner/wasm-scanner.tsx
import { useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { readBarcodes } from "zxing-wasm";
import type { ReadResult } from "zxing-wasm/reader";
import { initializeScanner } from "~/utils/barcode-scanner";
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
}: WasmScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>();
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number>();

  /** Initialize WASM module on component mount */
  useEffect(() => {
    void initializeScanner();
  }, []);

  /** Handle camera setup and cleanup */
  useEffect(() => {
    const setupCamera = async (deviceId?: string) => {
      try {
        // Clean up existing stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }

        // Initialize new stream with selected device
        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId } } // if we have a deviceID, use that
            : { facingMode: "environment" }, // else use the default back camera
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Set initial selected device if not already set
        if (!selectedDevice) {
          const activeTrack = stream.getVideoTracks()[0];
          const settings = activeTrack.getSettings();
          setSelectedDevice(settings.deviceId);
        }

        return true;
      } catch (error) {
        console.error("Camera setup error:", error);
        return false;
      }
    };

    void setupCamera(selectedDevice);

    // Cleanup function
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [selectedDevice]);

  /** Process video frames for QR detection */
  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || paused) return;

    const processFrame = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) return; // Wait for video to load

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      try {
        // Set canvas dimensions to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw frame and get image data
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Detect QR codes
        const results = await readBarcodes(imageData, {
          tryHarder: true,
          formats: ["QRCode"],
          maxNumberOfSymbols: 1,
        });

        if (results.length > 0) {
          drawDetectionBox(ctx, results[0].position);
          handleDetection(results[0].text);
        }
      } catch (error) {
        console.error("Frame processing error:", error);
      }

      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    void processFrame();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [paused]);

  /** Draw detection box around QR code */
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
  };

  /** Handle QR code detection */
  const handleDetection = (result: string) => {
    if (!result || incomingIsLoading) return;
    void onQrDetectionSuccess?.(result);
  };

  return (
    <div className={tw("scanner-container", className)}>
      <div className="relative size-full overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="pointer-events-none size-full object-cover"
        />
        <canvas ref={canvasRef} className="canvas-overlay size-full" />

        {/* Camera controls */}
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
