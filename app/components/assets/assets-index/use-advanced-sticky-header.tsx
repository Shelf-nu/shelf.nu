import type { RefObject, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";

export function useStickyHeaderPortal() {
  const [isSticky, setIsSticky] = useState(false);
  const originalHeaderRef = useRef<HTMLTableSectionElement>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({
    top: 0,
    left: 0,
    width: "100%",
    columnCoords: [] as { left: number; width: number }[],
  });

  useEffect(() => {
    const headerRefCurrent = originalHeaderRef.current;
    if (!headerRefCurrent) return;
    const columns = headerRefCurrent.rows[0].cells;
    const tableElement = headerRefCurrent.closest("table");
    if (!tableElement) return;

    function handleTableHorizontalScroll(e: Event) {
      const head = (e.target as HTMLDivElement).querySelector("thead");
      if (!head) return;
      const newColumnCoords = Array.from(columns).map((column) => ({
        width: column.offsetWidth,
        left: column.getBoundingClientRect().left,
      }));
      setCoords((prev) => ({ ...prev, columnCoords: newColumnCoords }));
    }

    const tableParent = tableElement.parentElement;

    tableParent?.addEventListener("scroll", handleTableHorizontalScroll);

    const observer = new IntersectionObserver(
      ([entry]) => {
        const newIsSticky = !entry.isIntersecting;
        setIsSticky(newIsSticky);

        if (newIsSticky) {
          setCoords({
            top: 0,
            left: tableElement.getBoundingClientRect().left,
            width: `${tableElement.getBoundingClientRect().width}px`,
            columnCoords: Array.from(columns).map((column) => ({
              width: column.offsetWidth,
              left: column.getBoundingClientRect().left,
            })),
          });
        }
      },
      {
        threshold: 0,
        rootMargin: `0px 0px 0px 0px`,
      }
    );

    if (headerRefCurrent) {
      observer.observe(headerRefCurrent);
    }

    return () => {
      if (headerRefCurrent) {
        observer.unobserve(headerRefCurrent);
      }
    };
  }, []);

  return { originalHeaderRef, isSticky, stickyHeaderRef, coords };
}

export const StickyHeader = ({
  children,
  isSticky,
  stickyHeaderRef,
  coords,
}: {
  children: ReactNode;
  isSticky: boolean;
  stickyHeaderRef: RefObject<HTMLDivElement>;
  coords: {
    top: number;
    left: number;
    width: string;
    columnCoords: { left: number; width: number }[];
  };
}) => {
  const { top, left, width, columnCoords } = coords;
  const { modeIsAdvanced } = useAssetIndexViewState();
  const frozen = useAssetIndexFreezeColumn();

  useEffect(() => {
    if (!isSticky) return;
    if (!stickyHeaderRef.current) return;
    const head = stickyHeaderRef.current.querySelector("thead");
    if (!head) return;

    const stickyColumns = head.rows[0].cells;

    Array.from(stickyColumns).forEach((stickyColumn, index) => {
      const source = columnCoords[index];
      const columnName = stickyColumn.dataset.columnName;

      stickyColumn.classList.add("sticky-column");
      stickyColumn.style.width = `${source.width}px`;

      if (source.left < left) {
        // This handles the overflow of the sticky header when scrolling to the right
        // If the left of the column is less than the left of the table, we need to adjust the width and left of the sticky column
        stickyColumn.style.width = `${source.width - (left - source.left)}px`;
        stickyColumn.style.left = `${left}px`;
      } else {
        stickyColumn.style.left = `${source.left - left}px`;
      }

      if (index === 0 && modeIsAdvanced && frozen) {
        // this is the first column for bulk actions
        stickyColumn.style.position = "sticky";
        stickyColumn.style.left = `0px`;
      }
      if (columnName === "name" && modeIsAdvanced && frozen) {
        stickyColumn.style.position = "sticky";
        stickyColumn.style.left = `48px`;
      }
    });
  }, [columnCoords, frozen, isSticky, left, modeIsAdvanced, stickyHeaderRef]);

  if (!isSticky) return null;

  return ReactDOM.createPortal(
    <div
      ref={stickyHeaderRef}
      style={{
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        width: width.at(-1) === "x" ? width : `${width}px`,
        height: 53,
        backgroundColor: "white",
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        zIndex: 1000,
      }}
    >
      {children}
    </div>,
    document.body
  );
};
