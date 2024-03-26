import { useEffect, useState } from "react";
import { useMediaDevices } from "react-media-devices";

// Custom hook to handle video devices
export const useQrScanner = () => {
  const { devices } = useMediaDevices({
    constraints: {
      video: true,
      audio: false,
    },
  });

  // Initialize videoMediaDevices as undefined. This will be used to store the video devices once they have loaded.
  const [videoMediaDevices, setVideoMediaDevices] = useState<
    MediaDeviceInfo[] | undefined
  >(undefined);

  useEffect(() => {
    if (devices) {
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput"
      );

      if (videoDevices.length === 0) {
        return;
      }

      setVideoMediaDevices(videoDevices);
    }
  }, [devices]);

  return {
    videoMediaDevices,
  };
};
