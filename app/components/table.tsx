import type { TdHTMLAttributes } from "react";
import React, { useEffect, useRef, useState } from "react";
import { tw } from "~/utils/tw";

export function Table({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
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
    window.addEventListener("resize", checkOverflow); // Check on resize

    // Ensure the scroll event listener is added correctly
    const container = containerRef.current;
    if (container) {
      container.addEventListener("scroll", checkOverflow);
    }

    return () => {
      window.removeEventListener("resize", checkOverflow);
      if (container) {
        container.removeEventListener("scroll", checkOverflow);
      }
    };
  }, []);

  return (
    <div className={`relative ${isOverflowing ? "overflowing" : ""}`}>
      <div className="fixed-gradient"></div>
      <div
        ref={containerRef}
        className="scrollbar-top scrollbar-always-visible"
      >
        <table className={tw("w-full table-auto border-collapse", className)}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function Th({
  children,
  className,
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <th
      className={tw(
        "p-4 text-left font-normal text-gray-600 md:border-b md:px-6",
        className
      )}
      colSpan={colSpan || undefined}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <tr className={tw("hover:bg-gray-50", className)}>{children}</tr>;
}

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children: React.ReactNode;
  className?: string;
}

export function Td({ children, className, ...props }: TdProps) {
  return (
    <td
      className={tw(
        "max-w-[200px] truncate whitespace-nowrap border-b p-4 md:px-6",
        className
      )}
      {...props}
    >
      {children}
    </td>
  );
}
