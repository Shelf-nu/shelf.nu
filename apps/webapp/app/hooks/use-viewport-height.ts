import { useEffect, useState } from "react";

export const useViewportHeight = () => {
  const [vh, setVh] = useState(
    typeof window !== "undefined" ? window.innerHeight : 0
  );
  const [isMd, setIsMd] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 768 : false
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      const handleResize = () => {
        setVh(window.innerHeight);
        setIsMd(window.innerWidth >= 768);
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  return { vh, isMd };
};
