import { useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { useNavigate, Link, json } from "@remix-run/react";
import { useMediaDevices } from "react-media-devices";
import { useZxing } from "react-zxing";
import { ErrorBoundryComponent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { useClientNotification } from "~/hooks/use-client-notification";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ShelfStackError } from "~/utils/error";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const header: HeaderData = {
    title: "Locations",
  };
  await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.location,
    action: PermissionAction.read,
  });

  return json({ header });
}

export const handle = {
  breadcrumb: () => <Link to="/scanner">QR code scanner</Link>,
};

export const meta: MetaFunction<typeof loader> = () => [
  { title: appendToMetaTitle("Qr code scanner") },
];

const QRScanner = () => {
  const [sendNotification] = useClientNotification();
  const navigate = useNavigate();
  const [selectedDevice, setSelectedDevice] = useState("");

  const { devices } = useMediaDevices({
    constraints: {
      video: true,
      audio: false,
    },
  });
  const videoMediaDevices = devices
    ? devices.filter((device) => device.kind === "videoinput")
    : [];

  const { ref: videoRef } = useZxing({
    deviceId: selectedDevice,
    constraints: { video: true, audio: false },
    onDecodeResult(result) {
      decodeQRCodes(result.getText());
    },
    onError() {
      throw new ShelfStackError({
        message: "Unable to access media devices permission",
        status: 403,
      });
    },
  });

  // const qrReader = new QrcodeDecoder();
  // qrReader.decodeFromCamera(videoRef.current).then((res: any) => {
  //   decodeQRCodes(res.data);
  // });

  // const startVideoStream = async (stream: MediaStream) => {
  //   const devices = await navigator.mediaDevices.enumerateDevices();

  //   const videoDevices = devices.filter(
  //     (device) => device.kind === "videoinput"
  //   );
  //   setDevices(videoDevices);
  //   const video = videoRef.current;
  //   if (video && stream && videoDevices) {
  //     video.muted = true;
  //     video.volume = 0;
  //     video.setAttribute("playsinline", "playsinline");
  //     video.srcObject = stream;
  //   }
  // };

  // const closeVideoStream = () => {
  //   currentStream?.getTracks().forEach((track) => track.stop());
  // };

  // const startVideoWithDefaultSettings = async () => {
  //   try {
  //     const stream = await navigator.mediaDevices.getUserMedia({
  //       audio: false,
  //       video: true,
  //     });

  //     setCurrentStream(stream);
  //     startVideoStream(stream);
  //     setPreferredDeviceAsSelected();
  //   } catch (err) {
  //     console.error("Error accessing media devices.", err);
  //   }
  // };

  // useEffect(() => {
  //   // if (!currentStream) {
  //   //   startVideoWithDefaultSettings();
  //   // }

  //   if (videoRef.current) {
  //     navigator.mediaDevices.enumerateDevices().then((devices) => {
  //       const videoDevices = devices.filter(
  //         (device) => device.kind === "videoinput"
  //       );
  //       setDevices(videoDevices);
  //       setSelectedDevice(videoDevices[0].deviceId);
  //       console.log(selectedDevice);
  //     });
  //   }

  //   //   const videoDevices = devices.filter(
  //   //     (device) => device.kind === "videoinput"
  //   //   );
  //   //   setDevices(videoDevices);
  // }, [videoRef]);

  const decodeQRCodes = (result: string) => {
    if (result != null) {
      const regex = /^(https?:\/\/)([^/:]+)(:\d+)?\/qr\/([a-zA-Z0-9]+)$/;
      const match = result.match(regex);

      if (match) {
        sendNotification({
          title: "Shelf's QR Code detected",
          message: "Redirecting to mapped asset",
          icon: { name: "success", variant: "success" },
        });
        const qrId = match[4]; // Get the last segment of the URL as the QR id
        navigate(`/qr/${qrId}`);
      } else {
        sendNotification({
          title: "QR Code Not Valid",
          message: "Please Scan valid asset QR",
          icon: { name: "trash", variant: "error" },
        });
      }
    }
  };

  // const changeUserMedia = async (deviceId: string) => {
  //   try {
  //     closeVideoStream();
  //     setSelectedDevice(deviceId);
  //     const constraints = { video: { deviceId: { exact: deviceId } } };
  //     const stream = await navigator.mediaDevices.getUserMedia(constraints);
  //     setCurrentStream(stream);
  //     await startVideoStream(stream);
  //   } catch (err) {
  //     console.error("Error accessing media devices.", err);
  //   }
  // };

  // const setPreferredDeviceAsSelected = async () => {
  //   const mediaStream = videoRef.current?.srcObject as MediaStream;
  //   const videoTrack = mediaStream?.getVideoTracks()[0];

  //   if (!videoTrack) return;

  //   await videoTrack?.applyConstraints();
  //   setSelectedDevice(videoTrack?.getSettings().deviceId || "");
  // };

  return (
    <>
      <Header title="QR code scanner" />
      <div className=" flex h-[calc(100vh-191px)] flex-col md:h-[calc(100vh-156px)]">
        <div className="m-auto h-5/6 min-h-[400px] py-6 xl:w-[70%]">
          <div className="relative h-full">
            <video
              ref={videoRef}
              width="100%"
              autoPlay={true}
              className={`h-full object-cover`}
            />
            {videoMediaDevices.length > 0 && (
              <select
                className="absolute bottom-3 left-3 w-[calc(100%-24px)] rounded border-0"
                name="devices"
                onChange={(e) => {
                  setSelectedDevice(e.currentTarget.value);
                }}
                defaultValue={selectedDevice}
              >
                {videoMediaDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* <div
            className={`flex h-full items-center justify-center text-center ${
              currentStream && "hidden"
            }`}
          >
            <p className="text-[18px] font-medium">
              Awaiting camera access....
            </p>
          </div> */}
        </div>
      </div>
    </>
  );
};

export default QRScanner;

export const ErrorBoundary = () => <ErrorBoundryComponent />;
