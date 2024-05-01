import { useEffect, useRef, useState } from "react";

/**
 * Hook to control the state of a dropdown menu.
 * If the user clicks outside the dropdown, it will close.
 * It is important to add the ref to the DropdownMenuContent component, otherwise it wont work
 * @param initialState boolean
 * @returns [React.RefObject<HTMLDivElement>, boolean, React.Dispatch<React.SetStateAction<boolean>>]
 */
export function useControlledDropdownMenu(
  initialState: boolean
): [
  React.RefObject<HTMLDivElement>,
  boolean,
  React.Dispatch<React.SetStateAction<boolean>>,
] {
  const [isOpen, setOpen] = useState(initialState);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return [ref, isOpen, setOpen];
}
