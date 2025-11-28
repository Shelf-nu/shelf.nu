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
  const defaultOpen = options?.skipDefault
    ? false
    : window.innerWidth <= 640 && refIsQrScan;

  const [open, setOpen] = useState(defaultOpen);
  const [defaultApplied, setDefaultApplied] = useState(false);

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

  useEffect(() => {
    if (defaultOpen && !defaultApplied) {
      setOpen(true);
      setDefaultApplied(true);
    }
  }, [defaultOpen, defaultApplied, setOpen]);

  return {
    ref,
    defaultOpen,
    defaultApplied,
    open,
    setOpen,
  };
}
