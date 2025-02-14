import { useEffect, useRef, useState } from "react";

// Custom hook to handle table right side scroll fade effect
export const useTableIsOverflowing = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const checkOverflow = () => {
      const container = containerRef.current;
      if (container) {
        const hasOverflow = container.scrollWidth > container.clientWidth;
        const hasReachedEnd =
          container.scrollLeft + container.clientWidth >= container.scrollWidth;
        setIsOverflowing(hasOverflow && !hasReachedEnd);
      }
    };

    checkOverflow(); // Initial check
    if (window) {
      window.addEventListener("resize", checkOverflow); // Check on resize
    }

    // Ensure the scroll event listener is added correctly
    const container = containerRef.current;
    if (container) {
      container.addEventListener("scroll", checkOverflow);
    }

    return () => {
      if (window) {
        window.removeEventListener("resize", checkOverflow);
      }
      if (container) {
        container.removeEventListener("scroll", checkOverflow);
      }
    };
  }, []);

  return { containerRef, isOverflowing };
};
