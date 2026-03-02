import { useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { Check, SwitchCamera } from "lucide-react";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";

interface CameraSelectorProps {
  devices: MediaDeviceInfo[];
  currentDeviceId: string | null;
  onCameraChange: (deviceId: string) => void;
  disabled?: boolean;
  /** Whether to show the text label (typically hidden on mobile) */
  showLabel?: boolean;
}

export function CameraSelector({
  devices,
  currentDeviceId,
  onCameraChange,
  disabled = false,
  showLabel = false,
}: CameraSelectorProps) {
  const [open, setOpen] = useState(false);

  // Don't render if only one camera
  if (devices.length <= 1) {
    return null;
  }

  const handleSelect = (deviceId: string) => {
    onCameraChange(deviceId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          disabled={disabled}
          className={tw(
            "gap-2 py-[7px] text-[12px] font-normal",
            open ? "bg-gray-50" : ""
          )}
          aria-label="Switch camera"
        >
          <SwitchCamera className="size-4" />
          {showLabel && <span>Switch camera</span>}
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="end"
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={tw(
            "z-[999999] mt-2 min-w-[200px] max-w-[300px] rounded-md border border-gray-200 bg-white shadow-md"
          )}
        >
          <div className="p-1" role="listbox" aria-label="Camera selection">
            {devices.map((device, index) => (
              <button
                key={device.deviceId}
                role="option"
                aria-selected={currentDeviceId === device.deviceId}
                className={tw(
                  "flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-sm",
                  "hover:bg-gray-50 focus:bg-gray-50 focus:outline-none",
                  currentDeviceId === device.deviceId && "bg-gray-50"
                )}
                onClick={() => handleSelect(device.deviceId)}
              >
                <span className="truncate">
                  {device.label || `Camera ${index + 1}`}
                </span>
                {currentDeviceId === device.deviceId && (
                  <Check className="size-4 shrink-0 text-primary" />
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
