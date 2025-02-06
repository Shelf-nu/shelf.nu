import { useState, useEffect, useCallback } from "react";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { tw } from "~/utils/tw";

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

  /**
   * Request access to video devices and enumerate available cameras
   * Memoized to prevent unnecessary re-renders
   */
  const getDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Request camera permissions first
      await navigator.mediaDevices.getUserMedia({ video: true });
      // Get all media devices
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      // Filter for video input devices only
      const videoDevices = allDevices.filter(
        (device) => device.kind === "videoinput"
      );
      // Set devices if any found, otherwise null
      setDevices(videoDevices.length > 0 ? videoDevices : null);
    } catch (err) {
      // Handle errors, ensuring we always set an Error object
      setError(err instanceof Error ? err : new Error("Failed to get devices"));
      setDevices(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Component for rendering permission-related UI states
   * Displays error messages or loading state
   */
  function DevicesPermissionComponent() {
    return (
      <div className="mx-auto mt-[60px] flex h-full max-w-[90%] flex-col items-center text-center">
        {error ? (
          error?.name === "NotAllowedError" ? (
            <>
              <p>
                Permissions have been denied. You need to allow shelf to use
                your device's camera to scan QR codes.
              </p>
              <Button
                variant="secondary"
                onClick={getDevices}
                className={tw(`mt-4`)}
              >
                Request permissions again
              </Button>
            </>
          ) : (
            <>{error.message}</>
          )
        ) : (
          <>
            <Spinner /> Waiting for permission to access camera/s.
          </>
        )}
      </div>
    );
  }

  /**
   * Set up device access and event listeners on mount
   * Clean up listeners on unmount
   */
  useEffect(() => {
    void getDevices();

    // Handler for device changes (e.g., camera connected/disconnected)
    const handleDeviceChange = async () => {
      await getDevices();
    };

    // Listen for device changes
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    // Cleanup listener on unmount
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange
      );
    };
  }, [getDevices]);

  console.log("devices", devices);
  console.log("error", error);

  // Return hook interface
  return {
    devices, // Available video devices
    error, // Error state
    loading, // Loading state
    requestPermissions: getDevices, // Function to request permissions
    DevicesPermissionComponent, // UI component for permissions
  };
};
