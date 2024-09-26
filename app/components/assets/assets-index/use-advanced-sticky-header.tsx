import type { RefObject } from "react";
import { useEffect, useRef, useCallback, useState } from "react";

function debounce(func: Function, wait: number) {
  let timeout: ReturnType<typeof setTimeout>;
  return function executedFunction(...args: any[]) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function useAdvancedStickyHeader(
  initialOffset: number = 317
): RefObject<HTMLTableSectionElement> {
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const ticking = useRef(false);
  const [isSticky, setIsSticky] = useState(false);
  const lastScrollTop = useRef(0);

  const updateHeader = useCallback(() => {
    if (!theadRef.current) return;
    const tableElement = theadRef.current.closest("table") as HTMLTableElement;
    if (!tableElement) return;

    const tableRect = tableElement.getBoundingClientRect();
    const headerRect = theadRef.current.getBoundingClientRect();
    const bodyRect = document.body.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;

    const shouldBeSticky = scrollTop > tableRect.top - bodyRect.top;

    if (shouldBeSticky !== isSticky) {
      setIsSticky(shouldBeSticky);
    }

    if (shouldBeSticky) {
      const bodyTop = bodyRect.top;
      const translateY = -bodyTop - initialOffset;

      theadRef.current.style.position = "fixed";
      theadRef.current.style.transform = `translateY(${translateY}px)`;
      theadRef.current.style.zIndex = "10";
      theadRef.current.style.width = `${tableRect.width}px`;

      // Adjust column widths
      const tableBody = tableElement.querySelector("tbody");
      if (tableBody && tableBody.rows.length > 0) {
        const tableColumns = tableBody.rows[0].cells;
        const theadColumns = theadRef.current.rows[0].cells;
        Array.from(theadColumns).forEach((theadColumn, index) => {
          if (tableColumns[index]) {
            if (theadColumn.dataset.columnName === "name") {
              const innerDiv = theadColumn.querySelector("div");
              if (innerDiv) {
                innerDiv.style.width = "275px";
                theadColumn.style.width = `${
                  tableColumns[index].offsetWidth + 0.5
                }px`;
              }
            } else {
              theadColumn.style.width = `${tableColumns[index].offsetWidth}px`;
            }
            theadColumn.style.borderBottom = "none";
          }
        });
      }

      // Add padding to the table body to prevent content jump
      if (tableElement.style.paddingTop === "") {
        tableElement.style.paddingTop = `${headerRect.height}px`;
      }
    } else {
      theadRef.current.style.position = "";
      theadRef.current.style.transform = "";
      theadRef.current.style.zIndex = "";
      theadRef.current.style.width = "";

      // Reset column widths
      const theadColumns = theadRef.current.rows[0].cells;
      Array.from(theadColumns).forEach((theadColumn) => {
        theadColumn.style.width = "";
        theadColumn.style.borderBottom = "";
        if (theadColumn.dataset.columnName === "name") {
          const innerDiv = theadColumn.querySelector("div");
          if (innerDiv) {
            innerDiv.style.width = "";
          }
        }
      });

      // Remove padding from the table body
      tableElement.style.paddingTop = "";
    }

    lastScrollTop.current = scrollTop;
  }, [initialOffset, isSticky]);

  const handleScroll = useCallback(() => {
    if (!ticking.current) {
      window.requestAnimationFrame(() => {
        updateHeader();
        ticking.current = false;
      });
      ticking.current = true;
    }
  }, [updateHeader]);

  const handleResize = debounce(() => {
    updateHeader();
  }, 100);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [handleScroll, handleResize]);

  return theadRef;
}
