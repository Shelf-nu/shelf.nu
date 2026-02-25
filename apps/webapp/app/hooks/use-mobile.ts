import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let mql: MediaQueryList;

    if (window) {
      mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

      mql.addEventListener("change", onChange);
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }

    function onChange() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }

    return () => {
      mql?.removeEventListener("change", onChange);
    };
  }, []);

  return !!isMobile;
}
