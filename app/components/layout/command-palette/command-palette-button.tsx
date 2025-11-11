import { useEffect, useState } from "react";
import { useMatches } from "react-router";
import { SearchIcon } from "lucide-react";

import { Button } from "~/components/shared/button";
import type { RouteHandleWithName } from "~/modules/types";
import { tw } from "~/utils/tw";
import { useCommandPaletteSafe } from "./command-palette-context";

type CommandPaletteButtonVariant = "default" | "icon";

function useShortcutLabel() {
  const [label, setLabel] = useState("⌘K");

  useEffect(() => {
    if (typeof navigator === "undefined") {
      return;
    }

    const isAppleDevice = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    setLabel(isAppleDevice ? "⌘K" : "Ctrl K");
  }, []);

  return label;
}

export function CommandPaletteButton({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: CommandPaletteButtonVariant;
}) {
  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];
  const shouldRenderButton = !["bookings.$bookingId.overview"].includes(
    // on the user bookings page we dont want to show the custodian filter becuase they are alreayd filtered for that user
    currentRoute?.handle?.name
  );
  const context = useCommandPaletteSafe();
  const shortcut = useShortcutLabel();

  // Don't render if the command palette provider is not available
  if (!context || !shouldRenderButton) {
    return null;
  }

  const { setOpen } = context;

  if (variant === "icon") {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        variant={"secondary"}
        className={tw(
          "flex items-center justify-center rounded border-0 bg-white px-2  py-[2px] text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 md:border-gray-200",
          className
        )}
      >
        <SearchIcon className="size-5" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      onClick={() => setOpen(true)}
      variant={"secondary"}
      className={tw(
        "flex w-full items-center gap-2 rounded bg-white py-2 text-sm text-gray-600 transition hover:border-gray-300 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 md:w-64 md:border md:border-gray-200",
        className
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span className="hidden sm:inline">Quick find</span>
        <span className="sm:hidden">Quick find...</span>
        <span className="ml-auto hidden items-center gap-1 rounded bg-gray-50 px-1 text-[10px] font-medium  text-gray-500 md:inline-flex md:border md:border-gray-200">
          {shortcut}
        </span>
      </div>
    </Button>
  );
}
