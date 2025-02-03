import { useEffect, useRef, useState } from "react";
import { TriangleLeftIcon } from "@radix-ui/react-icons";
import {
  Link,
  useFetcher,
  useNavigation,
  useRouteLoaderData,
} from "@remix-run/react";
import jsQR from "jsqr";
import { ClientOnly } from "remix-utils/client-only";
import type { LayoutLoaderResponse } from "~/routes/_layout+/_layout";
import { ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
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

type JsQRScannerProps = {
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

export const JsQRScanner = ({
  videoMediaDevices,
  onQrDetectionSuccess,
  isLoading: incomingIsLoading,
  backButtonText = "Back",
  allowNonShelfCodes = false,
  hideBackButtonText = false,
  className,
  overlayClassName,
  paused = false,
}: JsQRScannerProps) => {
  const scannerCameraId = useRouteLoaderData<LayoutLoaderResponse>(
    "routes/_layout+/_layout"
  )?.scannerCameraId;

  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const fetcher = useFetcher();
  const isSwitchingCamera = isFormProcessing(fetcher.state);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Function to decode the QR code
  const decodeQRCodes = (result: string) => {
    console.log("Decoding QR code:", result);
    if (result != null && !isLoading && !incomingIsLoading) {
      const regex = /^(https?:\/\/[^/]+\/(?:qr\/)?([a-zA-Z0-9]+))$/;
      const match = result.match(regex);
      if (!match) {
        console.log("QR code does not match expected format");
        onQrDetectionSuccess &&
          void onQrDetectionSuccess(
            result,
            "Scanned code is not a valid Shelf QR code."
          );
        return;
      }

      const qrId = match[2];
      if (!isQrId(qrId)) {
        if (allowNonShelfCodes) {
          console.log("Non-Shelf QR code detected");
          onQrDetectionSuccess &&
            void onQrDetectionSuccess(
              result,
              "Scanned code is not a valid Shelf QR code."
            );
        }
        return;
      }

      if (typeof navigator.vibrate === "function") {
        navigator.vibrate(200);
      }

      console.log("Valid Shelf QR code detected:", qrId);
      onQrDetectionSuccess && void onQrDetectionSuccess(qrId);
    }
  };

  // Start the camera and QR code scanning
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!video || !canvas || !context) return;

    const constraints = {
      video: {
        facingMode: "environment",
        deviceId: scannerCameraId ? { exact: scannerCameraId } : undefined,
      },
    };

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(async (stream) => {
        video.srcObject = stream;
        await video.play();
        requestAnimationFrame(tick);
      })
      .catch((err) => {
        console.error("Error accessing camera:", err);
        setError("Unable to access camera. Please check permissions.");
      });

    const tick = () => {
      if (paused || !video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        requestAnimationFrame(tick);
        return;
      }

      canvas.height = video.videoHeight;
      canvas.width = video.videoWidth;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code) {
        console.log("QR code detected:", code.data);
        decodeQRCodes(code.data);
      }

      requestAnimationFrame(tick);
    };

    return () => {
      if (video.srcObject) {
        (video.srcObject as MediaStream)
          .getTracks()
          .forEach((track) => track.stop());
      }
    };
  }, [scannerCameraId, paused]);

  return (
    <div
      className={tw(
        "relative size-full min-h-[400px] overflow-hidden",
        className
      )}
    >
      <div className={tw("relative size-full ")}>
        {isSwitchingCamera ? (
          <div className="mt-4 flex flex-col items-center justify-center">
            <Spinner /> Switching cameras...
          </div>
        ) : (
          <>
            <div className="absolute inset-x-0 top-0 z-10 flex w-full items-center justify-between bg-transparent  text-white">
              <div>
                {!hideBackButtonText ? (
                  <Link
                    to=".."
                    className="inline-flex items-center justify-start p-2 text-[11px] leading-[11px] text-white"
                  >
                    <TriangleLeftIcon className="size-[14px]" />{" "}
                    <span className="mt-[-0.5px]">{backButtonText}</span>
                  </Link>
                ) : null}
              </div>
              <div>
                <fetcher.Form
                  method="post"
                  action="/api/user/prefs/scanner-camera"
                  onChange={(e) => {
                    const form = e.currentTarget;
                    fetcher.submit(form);
                  }}
                >
                  {videoMediaDevices && videoMediaDevices?.length > 0 ? (
                    <Select
                      name="scannerCameraId"
                      defaultValue={scannerCameraId}
                    >
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
                            {device.label
                              ? device.label
                              : `Device ${index + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </fetcher.Form>
              </div>
            </div>

            <video
              ref={videoRef}
              width="100%"
              autoPlay={true}
              controls={false}
              muted={true}
              playsInline={true}
              className="pointer-events-none size-full object-cover object-center"
            />
            <canvas ref={canvasRef} style={{ display: "none" }} />

            {/* Overlay */}
            <div
              className={tw(
                "absolute left-1/2 top-[75px] h-[400px] w-11/12 max-w-[600px] -translate-x-1/2  rounded border-4 border-white shadow-camera-overlay before:absolute before:bottom-3 before:left-1/2 before:h-1 before:w-[calc(100%-40px)] before:-translate-x-1/2 before:rounded-full before:bg-white md:h-[600px]",
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
          </>
        )}
      </div>
    </div>
  );
};
