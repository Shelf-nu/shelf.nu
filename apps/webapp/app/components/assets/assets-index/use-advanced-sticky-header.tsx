import type { CSSProperties, RefObject, ReactNode } from "react";
import { useEffect, useReducer, useRef } from "react";
import ReactDOM from "react-dom";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";

/** Shape of the sticky-header positioning data tracked by the reducer. */
type StickyState = {
  isSticky: boolean;
  top: number;
  left: number;
  width: string;
  columnCoords: { left: number; width: number }[];
};

/**
 * Actions that can update the sticky-header state. Coalescing these
 * transitions into a reducer avoids cascading setState calls, which would
 * otherwise each trigger a separate commit.
 */
type StickyAction =
  | {
      type: "SET_STICKY";
      payload: {
        top: number;
        left: number;
        width: string;
        columnCoords: StickyState["columnCoords"];
      };
    }
  | { type: "SET_UNSTICKY" }
  | { type: "SET_COLUMN_COORDS"; payload: StickyState["columnCoords"] };

const initialStickyState: StickyState = {
  isSticky: false,
  top: 0,
  left: 0,
  width: "100%",
  columnCoords: [],
};

function stickyReducer(state: StickyState, action: StickyAction): StickyState {
  switch (action.type) {
    case "SET_STICKY":
      return {
        isSticky: true,
        ...action.payload,
      };
    case "SET_UNSTICKY":
      // Keep positioning coords; toggling only the flag avoids a second
      // re-render from clearing them separately.
      return { ...state, isSticky: false };
    case "SET_COLUMN_COORDS":
      return { ...state, columnCoords: action.payload };
    default:
      return state;
  }
}

export function useStickyHeaderPortal() {
  const originalHeaderRef = useRef<HTMLTableSectionElement>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const [state, dispatch] = useReducer(stickyReducer, initialStickyState);

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
      dispatch({ type: "SET_COLUMN_COORDS", payload: newColumnCoords });
    }

    const tableParent = tableElement.parentElement;

    // Use `{ passive: true }` so the listener never blocks the main thread's
    // scroll pipeline — we only read coords, we never call preventDefault.
    tableParent?.addEventListener("scroll", handleTableHorizontalScroll, {
      passive: true,
    });

    const observer = new IntersectionObserver(
      ([entry]) => {
        const newIsSticky = !entry.isIntersecting;

        if (newIsSticky) {
          dispatch({
            type: "SET_STICKY",
            payload: {
              top: 0,
              left: tableElement.getBoundingClientRect().left,
              width: `${tableElement.getBoundingClientRect().width}px`,
              columnCoords: Array.from(columns).map((column) => ({
                width: column.offsetWidth,
                left: column.getBoundingClientRect().left,
              })),
            },
          });
        } else {
          dispatch({ type: "SET_UNSTICKY" });
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
      tableParent?.removeEventListener("scroll", handleTableHorizontalScroll);
      if (headerRefCurrent) {
        observer.unobserve(headerRefCurrent);
      }
    };
  }, []);

  const { isSticky, top, left, width, columnCoords } = state;
  return {
    originalHeaderRef,
    isSticky,
    stickyHeaderRef,
    coords: { top, left, width, columnCoords },
  };
}

/**
 * Style object for the positional (dynamic) bits of the sticky header.
 * We only keep `top`, `left`, and `width` inline because they are computed
 * from live DOM measurements — everything else lives in Tailwind classes
 * to keep the inline style object small and cacheable.
 */
function stickyHeaderStyle({
  top,
  left,
  width,
}: {
  top: number;
  left: number;
  width: string;
}): CSSProperties {
  return {
    top: `${top}px`,
    left: `${left}px`,
    width: width.at(-1) === "x" ? width : `${width}px`,
  };
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
      // `isolate` creates a new stacking context so we can use a modest
      // z-index (z-30) instead of escalating values — avoids the
      // z-index:1000+ smell while still floating above table rows.
      className="fixed isolate z-30 h-[53px] bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)]"
      style={stickyHeaderStyle({ top, left, width })}
    >
      {children}
    </div>,
    document.body
  );
};
