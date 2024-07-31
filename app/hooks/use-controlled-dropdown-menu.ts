import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "~/hooks/search-params";

type UseControlledDropdownMenuReturn = {
  ref: React.RefObject<HTMLDivElement>;
  defaultOpen: boolean;
  defaultApplied: boolean;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

/**
 * Hook to control the state of a dropdown menu.
 * If the user clicks outside the dropdown, it will close.
 * It is important to add the ref to the DropdownMenuContent component, otherwise it wont work
 *
 * @returns {UseControlledDropdownMenuReturn}
 */
export function useControlledDropdownMenu(): UseControlledDropdownMenuReturn {
  const ref = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const refIsQrScan = searchParams.get("ref") === "qr";
  const defaultOpen = window.innerWidth <= 640 && refIsQrScan;

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
