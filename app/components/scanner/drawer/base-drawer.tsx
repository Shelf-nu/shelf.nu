// components/scanner/base-drawer.tsx
import { useEffect, useRef, useState } from "react";
import { useRouteLoaderData } from "@remix-run/react";
import { motion } from "framer-motion";
import { ChevronUpIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "~/components/shared/button";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { loader as layoutLoader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils/tw";
import { useGlobalModeViaObserver } from "../code-scanner";

// Type for the base drawer props
type BaseDrawerProps = {
  children: React.ReactNode | ((expanded: boolean) => React.ReactNode);
  className?: string;
  style?: React.CSSProperties;
  defaultExpanded?: boolean;
  title: string;
  onClear?: () => void;
  hasItems: boolean;
  emptyStateContent?:
    | React.ReactNode
    | ((expanded: boolean) => React.ReactNode);
};

/** Used for calculating expanded size */
const TOP_GAP = 80 + 53 + 8 + 16;

const Portal = ({ children }: { children: React.ReactNode }) =>
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
  emptyStateContent,
}: BaseDrawerProps) {
  const [expanded, setExpanded] = useState(
    defaultExpanded !== undefined ? defaultExpanded : false
  );
  const { vh } = useViewportHeight();

  let minimizedSidebar = useRouteLoaderData<typeof layoutLoader>(
    "routes/_layout+/_layout"
  )?.minimizedSidebar;

  const itemsListRef = useRef<HTMLDivElement>(null);

  // Handle scanning mode changes
  const mode = useGlobalModeViaObserver();
  useEffect(() => {
    setExpanded(mode === "scanner");
  }, [mode]);

  return (
    <Portal>
      <div
        className={tw(
          "fixed inset-x-0 bottom-0 rounded-t-3xl border bg-white transition-all duration-300 ease-in-out lg:right-[20px]",
          minimizedSidebar ? "lg:left-[68px]" : "lg:left-[278px]",
          className
        )}
        style={{
          height: expanded
            ? mode === "scanner"
              ? vh - 400
              : vh - TOP_GAP
            : hasItems
            ? 170
            : 148,
        }}
      >
        <div className={tw("h-full")} style={style}>
          <div className="mx-auto inline-flex size-full flex-col px-4 ">
            {/* Handle */}
            <motion.div
              className="py-1 text-center hover:cursor-grab"
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
            </motion.div>

            {/* Header */}
            <div className="flex items-center justify-between border-b text-left">
              <div className="py-4">{title}</div>

              {hasItems && onClear && (
                <Button
                  variant="block-link-gray"
                  onClick={onClear}
                  className="text-[12px] font-normal text-gray-500"
                >
                  Clear list
                </Button>
              )}
            </div>

            {/* Body */}
            {!hasItems ? (
              <div className="flex flex-col items-center px-3 py-6 text-center">
                {typeof emptyStateContent === "function"
                  ? emptyStateContent(expanded)
                  : emptyStateContent}
              </div>
            ) : (
              <div
                ref={itemsListRef}
                className="-ml-4 flex max-h-full w-screen flex-col overflow-scroll md:ml-0 md:w-full"
              >
                {typeof children === "function" ? children(expanded) : children}
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
