import React, {
  useRef,
  useEffect,
  useContext,
  useState,
  useCallback,
} from "react";
import { useNavigate } from "@remix-run/react";
import {
  BrowserMultiFormatReader,
  DecodeHintType,
  BarcodeFormat,
} from "@zxing/library";
import { useClientNotification } from "~/hooks/use-client-notification";
// import {
//   MediaStreamContext,
//   useMediaStream,
//   useStopMediaStream,
// } from "./media-stream-provider";
import { XIcon } from "../icons";

interface QRScannerProps {
  onClose: () => void;
}

const QRScanner: React.FC<QRScannerProps> = ({ onClose }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastScannedData = useRef<string | null>(null); // to store the last scanned result
  // const { videoDevices, onChangeConstraints } = useContext(MediaStreamContext);
  const [sendNotification] = useClientNotification();
  // const { stopMediaStream, videoDevices, onChangeConstraints } =
  //   useMediaStream();
  // useStopMediaStream(stopMediaStream);
  const [scanCompleted, setScanCompleted] = useState(false);
  const navigate = useNavigate();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");

  const decodeQRCodes = useCallback(() => {
    const codeReader = new BrowserMultiFormatReader();
    const hints = new Map<DecodeHintType, any>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    codeReader.hints = hints;

    if (videoRef.current) {
      codeReader.decodeFromVideoDevice(null, videoRef.current, (result) => {
        if (result) {
          const scannedData = result.getText();

          if (scannedData != null) {
            // Check if the new scanned data is same as the last one
            if (lastScannedData.current !== scannedData) {
              lastScannedData.current = scannedData; // Update the lastScannedData

              const regex =
                /^(https?:\/\/)([^/:]+)(:\d+)?\/qr\/([a-zA-Z0-9]+)$/;
              const match = scannedData.match(regex);

              if (match) {
                // stopMediaStream();
                const qrId = match[4]; // Get the last segment of the URL as the QR id

                setScanCompleted(true); // Set the scanCompleted state to true
                // window.location.href = scannedData;

                navigate(`/qr/${qrId}`);
              } else {
                sendNotification({
                  title: "QR Code Not Valid",
                  message: "Please Scan valid asset QR",
                  icon: { name: "trash", variant: "error" },
                });
              }
            }
          }
        }
      });
    }
  }, [navigate, sendNotification]);

  const startVideoStream = useCallback(
    async (stream: MediaStream) => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput"
      );
      setDevices(videoDevices);
      if (videoRef.current && stream) {
        videoRef.current.muted = true;
        videoRef.current.volume = 0;
        videoRef.current.setAttribute("playsinline", "playsinline");
        videoRef.current.srcObject = stream;
        // videoRef.current
        //   .play()
        //   .then(() => console.log("playing"))
        //   .catch((err) => console.log(err));
        decodeQRCodes();
      }
    },
    [decodeQRCodes]
  );
  const changeUserMedia = async (deviceId: string) => {
    try {
      setSelectedDevice(deviceId);
      const constraints = { video: { deviceId: { exact: deviceId } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      startVideoStream(stream);
    } catch (err) {
      console.error("Error accessing media devices.", err);
    }
  };

  useEffect(() => {
    const getMediaDevices = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
        setPreferredDeviceAsSelected();
        startVideoStream(stream);
      } catch (err) {
        console.error("Error accessing media devices.", err);
      }
    };

    getMediaDevices();
  }, []);

  const setPreferredDeviceAsSelected = async () => {
    const mediaStream = videoRef.current?.srcObject as MediaStream;
    const videoTrack = mediaStream?.getVideoTracks()[0];

    if (!videoTrack) return;

    await videoTrack?.applyConstraints();
    setSelectedDevice(videoTrack?.getSettings().deviceId || "");
  };

  // navigator.mediaDevices.getUserMedia({ audio: false, video: true }).then(() =>
  //   navigator.mediaDevices
  //     .enumerateDevices()
  //     .then((devices) => {
  //       setDevices(devices.filter((device) => device.kind === "videoinput"));
  //     })
  //     .catch((error) => console.error(error))
  // );

  // navigator.mediaDevices.addEventListener("devicechange", () => {
  //   navigator.mediaDevices
  //     .enumerateDevices()
  //     .then((devices) => {
  //       setDevices(devices);
  //     })
  //     .catch((error) => console.error(error));
  // });

  // useEffect(() => {
  //   navigator.mediaDevices
  //     .getUserMedia({ audio: false, video: true })
  //     .then(() =>
  //       navigator.mediaDevices
  //         .enumerateDevices()
  //         .then((devices) => {
  //           setDevices(devices);
  //         })
  //         .catch((error) => console.error(error))
  //     );
  //   //    (async () => {
  //   //    await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  //   //    devices = await navigator.mediaDevices.enumerateDevices();
  //   //    setDevices(devices);
  //   //  })();
  //   navigator.mediaDevices.addEventListener("devicechange", () => {
  //     navigator.mediaDevices
  //       .enumerateDevices()
  //       .then((devices) => {
  //         setDevices(devices);
  //       })
  //       .catch((error) => console.error(error));
  //   });
  // }, [devices]);

  // useEffect(() => {
  //   const codeReader = new BrowserMultiFormatReader();
  //   const hints = new Map<DecodeHintType, any>();
  //   hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  //   hints.set(DecodeHintType.TRY_HARDER, true);
  //   codeReader.hints = hints;

  //   if (videoRef.current) {
  //     codeReader.decodeFromVideoDevice(null, videoRef.current, (result) => {
  //       if (result) {
  //         const scannedData = result.getText();

  //         if (scannedData != null) {
  //           // Check if the new scanned data is same as the last one
  //           if (lastScannedData.current !== scannedData) {
  //             lastScannedData.current = scannedData; // Update the lastScannedData

  //             const regex =
  //               /^(https?:\/\/)([^/:]+)(:\d+)?\/qr\/([a-zA-Z0-9]+)$/;
  //             const match = scannedData.match(regex);

  //             if (match) {
  //               // stopMediaStream();
  //               const qrId = match[4]; // Get the last segment of the URL as the QR id

  //               setScanCompleted(true); // Set the scanCompleted state to true
  //               // window.location.href = scannedData;

  //               navigate(`/qr/${qrId}`);
  //             } else {
  //               sendNotification({
  //                 title: "QR Code Not Valid",
  //                 message: "Please Scan valid asset QR",
  //                 icon: { name: "trash", variant: "error" },
  //               });
  //             }
  //           }
  //         }
  //       }
  //     });
  //   }
  //   return () => {
  //     codeReader.reset();

  //     // stopMediaStream();
  //   };
  // }, [sendNotification, navigate]);

  return (
    <>
      {!scanCompleted && (
        <div className="relative">
          <video ref={videoRef} width="100%" height="720px" autoPlay={true} />
          <select
            name="devices"
            onChange={(e) => {
              changeUserMedia(e.currentTarget.value);
            }}
          >
            <option value="">select</option>
            {devices.map((device) => (
              <option
                key={device.deviceId}
                value={device.deviceId}
                selected={selectedDevice === device.deviceId}
              >
                {device.label}
              </option>
            ))}
          </select>
          <button
            className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-red-500 text-white"
            onClick={onClose}
            title="Close Scanner"
          >
            <XIcon />
          </button>
        </div>
      )}
    </>
  );
};

export default QRScanner;
