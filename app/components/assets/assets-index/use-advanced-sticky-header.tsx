import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function useStickyHeaderPortal(stickyOffset: number = 0) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null
  );
  const [isSticky, setIsSticky] = useState(false);
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    //
    const headerRefCurrent = headerRef.current;
    if (!headerRefCurrent) return;

    const tableElement = headerRefCurrent.closest("table");
    if (!tableElement) return;
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.top = "0";
    container.style.left = `${tableElement?.getBoundingClientRect().left}px`;
    container.style.width = `${tableElement?.getBoundingClientRect().width}px`;
    container.style.zIndex = "1000";
    document.body.appendChild(container);
    setPortalContainer(container);

    const observer = new IntersectionObserver(
      ([entry]) => {
        const newIsSticky = !entry.isIntersecting;
        setIsSticky(newIsSticky);
      },
      {
        threshold: 0,
        rootMargin: `-${stickyOffset}px 0px 0px 0px`,
      }
    );

    if (headerRef.current) {
      observer.observe(headerRef.current);
    }

    return () => {
      document.body.removeChild(container);
      if (headerRefCurrent) {
        observer.unobserve(headerRefCurrent);
      }
    };
  }, [stickyOffset]);

  useEffect(() => {
    const handleResize = () => {
      if (portalContainer && headerRef.current) {
        const tableElement = headerRef.current.closest("table");
        portalContainer.style.left = `${tableElement?.getBoundingClientRect()
          .left}px`;
        portalContainer.style.width = `${tableElement?.getBoundingClientRect()
          .width}px`;
        // if (isSticky) {
        //   adjustColumnWidths();
        // }
      }
    };

    if (isSticky) {
      if (!headerRef.current) return;
      const tableElement = headerRef.current.closest("table");
      if (!tableElement) return;
      // Fix the header widths
      // Adjust column widths
      // THEEAD of the original table
      const tableHead = tableElement.querySelector("thead");
      if (!tableHead || tableHead.rows.length <= 0) return;

      const theadColumns = tableHead.rows[0].cells;
      const stickyColumns =
        stickyRef.current?.querySelector("thead")?.rows[0].cells;

      console.log("theadColumns", theadColumns);
      console.log("stickyColumns", stickyColumns);

      if (stickyColumns && theadColumns.length === stickyColumns.length) {
        Array.from(stickyColumns).forEach((stickyColumn, index) => {
          if (theadColumns[index]) {
            /** For this column we need to handle it in a special way because its position is sticky so we cant adjust its width directly */
            if (stickyColumn.dataset.columnName === "name") {
              const innerDiv = stickyColumn.querySelector("div");
              if (innerDiv) {
                innerDiv.style.width = "275px";
                // Add 0.5px to the width make columns align properly. Not sure why this is needed
                stickyColumn.style.width = `${
                  theadColumns[index].offsetWidth + 0.5
                }px`;
              }
            } else {
              stickyColumn.style.width = `${theadColumns[index].offsetWidth}px`;
            }
            stickyColumn.style.borderBottom = "none";
          }
        });
      }
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [portalContainer, isSticky]);

  const StickyHeader: React.FC<{ children: React.ReactNode }> = ({
    children,
  }) => {
    if (!portalContainer || !isSticky) return null;

    return createPortal(
      <div
        ref={stickyRef}
        style={{
          position: "sticky",
          top: `${stickyOffset}px`,
          width: "100%",
          background: "white",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          zIndex: 1000,
        }}
      >
        {children}
      </div>,
      portalContainer
    );
  };

  return { headerRef, StickyHeader };
}
