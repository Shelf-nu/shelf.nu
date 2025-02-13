import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";

/**
 * Custom hook for managing access to video input devices (cameras)
 * Handles device enumeration, permissions, and status updates
 *
 * @returns {Object} Object containing:
 * - devices: Array of available video input devices or null
 * - error: Error object if device access fails
 * - loading: Boolean indicating if device enumeration is in progress
 * - requestPermissions: Function to request device access
 * - DevicesPermissionComponent: React component for rendering permission UI
 */
export const useVideoDevices = () => {
  // Track available video devices
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  // Track any errors during device access
  const [error, setError] = useState<Error | null>(null);
  // Track loading state during device enumeration
  const [loading, setLoading] = useState(true);

  // Ref to track the active media stream
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true); // Track mount state
  /**
   * Request access to video devices and enumerate available cameras
   * Memoized to prevent unnecessary re-renders
   */
  const getDevices = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Stop existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      // Check if component is still mounted
      if (!isMountedRef.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = mediaStream;

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(
        (device) => device.kind === "videoinput"
      );

      if (isMountedRef.current) {
        setDevices(videoDevices.length > 0 ? videoDevices : null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error ? err : new Error("Failed to get devices")
        );
        setDevices(null);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  /**
   * Component for rendering permission-related UI states
   * Displays error messages or loading state
   */
  function DevicesPermissionComponent() {
    const renderContent = () => {
      switch (true) {
        case !error:
          return (
            <>
              <Spinner /> Waiting for permission to access camera/s.
            </>
          );

        case error?.name === "NotAllowedError":
          return (
            <>
              <p>
                Permissions have been denied. You need to allow shelf to use
                your device's camera to scan QR codes.
              </p>
              <Button variant="secondary" onClick={getDevices} className="mt-4">
                {/* @TODO this doesnt work in chrome or firefox on the web, only on mobile. Only tested on iPhone */}
                Request permissions again
              </Button>
            </>
          );

        case error?.name === "NotFoundError":
          return (
            <>
              <p>
                No media devices found. Please ensure you have a camera
                connected to your device.
              </p>
            </>
          );

        default:
          return <>{error.message}</>;
      }
    };

    return (
      <div className="mx-auto mt-16 flex h-full max-w-[90%] flex-col items-center text-center">
        {renderContent()}
      </div>
    );
  }

  /**
   * Set up device access and event listeners on mount
   * Clean up listeners on unmount
   */
  useEffect(() => {
    isMountedRef.current = true; // Set mount state

    void getDevices();

    const handleDeviceChange = () => {
      if (isMountedRef.current) void getDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      isMountedRef.current = false; // Mark as unmounted

      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange
      );

      // Stop active stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      // Safari-specific workaround: Revoke permissions
      if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
        navigator.mediaDevices
          .getUserMedia({ video: true })
          .then((stream) => stream.getTracks().forEach((track) => track.stop()))
          .catch(() => {});
      }
    };
  }, [getDevices]);

  // Return hook interface
  return {
    devices, // Available video devices
    error, // Error state
    loading, // Loading state
    requestPermissions: getDevices, // Function to request permissions
    DevicesPermissionComponent, // UI component for permissions
  };
};
