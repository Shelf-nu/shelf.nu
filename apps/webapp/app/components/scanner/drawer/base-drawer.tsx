import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { ChevronUpIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { useRouteLoaderData } from "react-router";
import { Button } from "~/components/shared/button";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { loader as layoutLoader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils/tw";
import { useGlobalModeViaObserver } from "../code-scanner";
import { resolveDrawerHeight } from "./drawer-height";

// Type for the base drawer props
type BaseDrawerProps = {
  children: ReactNode | ((expanded: boolean) => ReactNode);
  className?: string;
  style?: CSSProperties;
  defaultExpanded?: boolean;
  title?: string | ReactNode;
  onClear?: () => void;
  hasItems: boolean;
  renderWhenEmpty?: boolean;
  emptyStateContent?: ReactNode | ((expanded: boolean) => ReactNode);
  headerContent?: ReactNode;
  /**
   * Action area pinned below the scrolling item list — typically the drawer's
   * submit form.
   *
   * It belongs here rather than at the end of `children` because a drawer's
   * whole purpose is the action it commits: a submit button that scrolls away
   * with the list is one a long list can hide completely. Its measured height
   * counts towards the collapsed size, so the action is reachable without
   * expanding the drawer first.
   */
  footer?: ReactNode | ((expanded: boolean) => ReactNode);
  /** Custom height for the collapsed state when items are present (default: 170) */
  collapsedHeight?: number;
};

const Portal = ({ children }: { children: ReactNode }) =>
  createPortal(children, document.body);

/**
 * Base drawer component for the scanner UI
 */
export default function BaseDrawer({
  children,
  className,
  style,
  defaultExpanded = false,
  title,
  onClear,
  hasItems,
  renderWhenEmpty = false,
  emptyStateContent,
  headerContent,
  footer,
  collapsedHeight = 170,
}: BaseDrawerProps) {
  // The scanner's global mode owns whether the drawer is open. Hardware-
  // scanner mode has no viewfinder to watch, so the scanned list is what the
  // operator needs on screen; camera mode keeps the drawer low so the
  // viewfinder stays visible.
  const mode = useGlobalModeViaObserver();

  // Seeded from the mode the drawer MOUNTS into, not just from later switches:
  // on a desktop-width viewport scanner mode is already active on the first
  // render, so a reconciler that fires only on a CHANGE of mode would leave
  // that drawer collapsed forever.
  const [expanded, setExpanded] = useState(
    defaultExpanded || mode === "scanner"
  );
  const { vh } = useViewportHeight();

  const minimizedSidebar = useRouteLoaderData<typeof layoutLoader>(
    "routes/_layout+/_layout"
  )?.minimizedSidebar;

  const itemsListRef = useRef<HTMLDivElement>(null);
  const headerContentRef = useRef<HTMLDivElement>(null);
  const baseHeaderRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [chromeHeight, setChromeHeight] = useState<number | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);

  // Snap to the new mode's preferred state whenever the mode toggles. The
  // previous mode is compared during render and the state reconciled in place
  // — the recommended pattern for adjusting state on a prop/observer change,
  // per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // This handles switches only; the mount case is seeded above.
  const previousModeRef = useRef(mode);
  if (previousModeRef.current !== mode) {
    previousModeRef.current = mode;
    setExpanded(mode === "scanner");
  }

  // Measure the drawer's fixed chrome so the collapsed state can size itself
  // to whatever the caller renders. Drawers with custom header content are
  // measured whole; the rest keep their `collapsedHeight` constant and only
  // need the footer's height added to it.
  useEffect(() => {
    if (!headerContent && !footer) {
      return;
    }

    const calculateChromeHeight = () => {
      // The footer is pinned, so it occupies the collapsed drawer too —
      // leaving it out pushes the submit button below the bottom edge.
      const measuredFooter = footerRef.current?.offsetHeight || 0;
      setFooterHeight(measuredFooter);

      if (!headerContent) {
        setChromeHeight(null);
        return;
      }

      const dragHandleHeight = 36; // Approximate height of drag handle
      const headerContentHeight = headerContentRef.current?.offsetHeight || 0;
      const baseHeaderHeight = baseHeaderRef.current?.offsetHeight || 60; // Default base header height
      const padding = 16; // Some padding for safety

      setChromeHeight(
        dragHandleHeight +
          headerContentHeight +
          baseHeaderHeight +
          measuredFooter +
          padding
      );
    };

    // Calculate immediately
    calculateChromeHeight();

    // Recalculate on window resize
    const handleResize = () => calculateChromeHeight();
    const abortController = new AbortController();
    window.addEventListener("resize", handleResize, {
      signal: abortController.signal,
    });

    // Use ResizeObserver to detect changes in the measured chrome
    const resizeObserver = new ResizeObserver(() => calculateChromeHeight());

    if (headerContentRef.current) {
      resizeObserver.observe(headerContentRef.current);
    }
    if (baseHeaderRef.current) {
      resizeObserver.observe(baseHeaderRef.current);
    }
    if (footerRef.current) {
      resizeObserver.observe(footerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
    };
  }, [headerContent, footer, title, hasItems, onClear]);

  // Allow callers to show a non-empty body even when there are no items.
  const shouldRenderBody = hasItems || renderWhenEmpty;

  return (
    <Portal>
      <div
        className={tw(
          "fixed inset-x-0 bottom-0 rounded-t-3xl border bg-white transition-all duration-300 ease-in-out lg:right-[20px]",
          minimizedSidebar ? "lg:left-[68px]" : "lg:left-[278px]",
          className
        )}
        style={{
          height: resolveDrawerHeight({
            expanded,
            isScannerMode: mode === "scanner",
            viewportHeight: vh,
            // Only drawers with custom header content are measured; the rest
            // fall back to the `collapsedHeight` constant plus the footer.
            chromeHeight: headerContent ? chromeHeight : null,
            footerHeight,
            hasBody: shouldRenderBody,
            collapsedHeight,
          }),
        }}
      >
        <div className={tw("h-full")} style={style}>
          <div className="mx-auto inline-flex size-full flex-col px-4 ">
            {/* Handle */}
            <m.div
              className="shrink-0 py-1 text-center hover:cursor-grab"
              onClick={() => {
                setExpanded((prev) => !prev);
              }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              onDragEnd={(_, info) => {
                const shouldExpand = info.offset.y < 0;
                setExpanded(shouldExpand);
              }}
            >
              {/* Drag me */}
              <ChevronUpIcon
                className={tw(
                  "mx-auto text-gray-500",
                  expanded && "rotate-180 "
                )}
              />
            </m.div>

            {/* Extra Header Content - Always visible.

                The header is the one piece of chrome that yields. Handle,
                title bar and footer are `shrink-0` and the body has a zero
                basis, so when the clamped height cannot hold everything the
                deficit has to land somewhere — and anywhere else means the
                pinned action renders past the bottom of a `fixed` box, with
                no scroll path to it. The outer wrapper absorbs the deficit
                and scrolls; the inner div keeps its natural height so the
                measurement below still reports what the drawer WANTS, which
                is what the clamp is deciding against. */}
            <div className="min-h-0 shrink overflow-y-auto">
              <div ref={headerContentRef}>{headerContent}</div>
            </div>

            {/* Base Header */}
            <div
              ref={baseHeaderRef}
              className="default-base-drawer-header flex shrink-0 items-center justify-between border-b text-left"
            >
              <div className="py-4">{title}</div>

              {hasItems && onClear && (
                <Button
                  type="button"
                  variant="block-link-gray"
                  onClick={onClear}
                  className="text-[12px] font-normal text-gray-500"
                >
                  Clear list
                </Button>
              )}
            </div>

            {/* Body — the only part that scrolls. `min-h-0` is load-bearing:
                without it a flex item refuses to shrink below its content, so
                a long list would push the footer out of the drawer entirely
                instead of scrolling inside it. */}
            {!shouldRenderBody ? (
              <div className="flex shrink-0 flex-col items-center px-3 py-6 text-center">
                {typeof emptyStateContent === "function"
                  ? emptyStateContent(expanded)
                  : emptyStateContent}
              </div>
            ) : (
              <div
                ref={itemsListRef}
                className="-ml-4 flex min-h-0 w-screen flex-1 flex-col overflow-y-scroll md:ml-0 md:w-full"
              >
                {typeof children === "function" ? children(expanded) : children}
              </div>
            )}

            {/* Footer — pinned below the scroll area so the drawer's action
                stays reachable no matter how long the list gets. */}
            {footer ? (
              <div className="shrink-0" ref={footerRef}>
                {typeof footer === "function" ? footer(expanded) : footer}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Portal>
  );
}
