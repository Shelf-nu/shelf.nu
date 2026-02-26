import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "~/hooks/search-params";

type UseControlledDropdownMenuReturn = {
  ref: RefObject<HTMLDivElement | null>;
  defaultOpen: boolean;
  defaultApplied: boolean;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
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

  // Reactively calculate if menu should auto-open based on current state
  const shouldAutoOpen =
    !options?.skipDefault &&
    typeof window !== "undefined" &&
    window.innerWidth <= 640 &&
    refIsQrScan;

  // Apply auto-open when conditions are met
  useEffect(() => {
    if (shouldAutoOpen && !defaultApplied) {
      setOpen(true);
      setDefaultApplied(true);
    }
  }, [shouldAutoOpen, defaultApplied]);

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
  };
}
