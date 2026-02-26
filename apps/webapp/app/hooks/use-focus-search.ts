import type { RefObject } from "react";
import { useEffect } from "react";

/** Focuses on the field when user clicks cmd + k or ctrl + k */
export function useFocusSearch(ref: RefObject<HTMLInputElement>) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        ref?.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ref]);
}
