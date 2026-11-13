import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "~/hooks/search-params";
import { isSheetViewport } from "~/utils/sheet-viewport";

type UseControlledDropdownMenuReturn = {
  ref: RefObject<HTMLDivElement | null>;
  defaultOpen: boolean;
  defaultApplied: boolean;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  /**
   * Pass to the Radix menu's `onOpenChange`. On desktop it applies every open
   * change Radix asks for: the trigger (mouse and keyboard), Escape, Tab-out,
   * an outside click and an item select. The trigger must therefore not also
   * toggle `open` in its own `onClick`, or one click opens and closes it.
   * On a sheet viewport it applies them only after a QR-scan auto-open: there
   * the desktop trigger is hidden, and the mobile button and overlay drive it.
   */
  onOpenChange: (open: boolean) => void;
};

interface Options {
  /**
   * Set this to true if you want to skip the defaultOpen functionality for small screens when scanning
   * This is useful as we don't want to open all versions of a dropdown by default when scanning a QR code
   */
  skipDefault?: boolean;
}

/**
 * Hook to control the state of a dropdown menu.
 * If the user clicks outside the dropdown, it will close.
 * It is important to add the ref to the DropdownMenuContent component, otherwise it wont work
 *
 * @returns {UseControlledDropdownMenuReturn}
 */
export function useControlledDropdownMenu(
  options: Options = {}
): UseControlledDropdownMenuReturn {
  const ref = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const refIsQrScan = searchParams.get("ref") === "qr";

  const [open, setOpen] = useState(false);
  const [defaultApplied, setDefaultApplied] = useState(false);

  // A QR scan opens the menu wherever it renders as a bottom sheet (below `md`)
  const shouldAutoOpen =
    !options?.skipDefault && isSheetViewport() && refIsQrScan;

  // Apply auto-open when conditions are met
  useEffect(() => {
    if (shouldAutoOpen && !defaultApplied) {
      setOpen(true);
      setDefaultApplied(true);
    }
  }, [shouldAutoOpen, defaultApplied]);

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isSheetViewport() || defaultApplied) setOpen(nextOpen);
    },
    [defaultApplied]
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const alertDialog = document.querySelector('[role="alertdialog"]');

      if (
        ref.current &&
        !ref.current.contains(target) &&
        (!alertDialog || !alertDialog.contains(target))
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return {
    ref,
    defaultOpen: shouldAutoOpen,
    defaultApplied,
    open,
    setOpen,
    onOpenChange,
  };
}
