import type { RefObject } from "react";
import { useEffect, useRef } from "react";

export function useAdvancedStickyHeader(): RefObject<HTMLTableSectionElement> {
  const theadRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!theadRef.current) return;

      const tableElement = theadRef.current.parentElement as HTMLTableElement;
      const tableRect = tableElement.getBoundingClientRect();
      const headerRect = theadRef.current.getBoundingClientRect();
      const bodyRect = document.body.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;

      if (scrollTop > tableRect.top - bodyRect.top) {
        const bodyTop = bodyRect.top;
        theadRef.current.style.position = "fixed";

        // 317 is some magical number that makes the header have the correct position. No idea where it comes from
        theadRef.current.style.top = `${-bodyTop - 317}px`;
        theadRef.current.style.zIndex = "10";

        // Adjust column widths
        const tableBody = tableElement.querySelector("tbody");
        if (tableBody && tableBody.rows.length > 0) {
          const tableColumns = tableBody.rows[0].cells;
          const theadColumns = theadRef.current.rows[0].cells;
          Array.from(theadColumns).forEach((theadColumn, index) => {
            if (tableColumns[index]) {
              (
                theadColumn as HTMLTableCellElement
              ).style.width = `${tableColumns[index].offsetWidth}px`;
            }
          });
        }

        // Add padding to the table body to prevent content jump
        tableElement.style.paddingTop = `${headerRect.height}px`;
      } else {
        theadRef.current.style.position = "";
        theadRef.current.style.top = "";
        theadRef.current.style.left = "";
        theadRef.current.style.width = "";
        theadRef.current.style.zIndex = "";

        // Reset column widths
        const theadColumns = theadRef.current.rows[0].cells;
        Array.from(theadColumns).forEach((theadColumn) => {
          (theadColumn as HTMLTableCellElement).style.width = "";
        });

        // Remove padding from the table body
        tableElement.style.paddingTop = "";
      }
    };

    window.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  return theadRef;
}
