import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";

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
  const context = useCommandPaletteSafe();
  const shortcut = useShortcutLabel();

  // Don't render if the command palette provider is not available
  if (!context) {
    return null;
  }

  const { setOpen } = context;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        className={tw(
          "flex size-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2",
          className
        )}
      >
        <SearchIcon className="size-5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={tw(
        "flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 md:w-64",
        className
      )}
    >
      <SearchIcon className="size-4" />
      <span className="hidden sm:inline">Search</span>
      <span className="sm:hidden">Search...</span>
      <span className="ml-auto hidden items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 md:inline-flex">
        {shortcut}
      </span>
    </button>
  );
}
