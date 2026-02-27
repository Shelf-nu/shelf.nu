import { useEffect, useState } from "react";

export const useViewportHeight = () => {
  // Always initialize with server-safe defaults to prevent hydration mismatch.
  // Actual viewport values are set after mount in useEffect.
  const [vh, setVh] = useState(0);
  const [isMd, setIsMd] = useState(false);

  useEffect(() => {
    setVh(window.innerHeight);
    setIsMd(window.innerWidth >= 768);

    const handleResize = () => {
      setVh(window.innerHeight);
      setIsMd(window.innerWidth >= 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return { vh, isMd };
};
