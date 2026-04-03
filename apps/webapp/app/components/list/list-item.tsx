import type React from "react";
import type { ReactNode } from "react";
import { memo } from "react";
import type { MotionProps } from "framer-motion";
import { motion } from "framer-motion";
import { tw } from "~/utils/tw";

export interface ListItemData {
  id: string;
  [x: string]: any;
}

export interface ListItemProps {
  item: ListItemData;
  children: ReactNode;
  navigate?: (id: string, item: ListItemData) => void;
  className?: string;
  motionProps?: MotionProps;
}

/**
 * Chromium-based browsers have a hover-on-scroll bug (open since 2014).
 * These styles work around it without needing framer-motion.
 */
const CHROMIUM_HOVER_FIX = {
  transform: "translateZ(0)",
  willChange: "transform",
  backgroundAttachment: "initial",
} as const;

export const ListItem = memo(function ListItem({
  item,
  children,
  navigate,
  className,
  motionProps,
}: ListItemProps) {
  const handleClick = (event: React.MouseEvent) => {
    if (navigate) {
      // Check if Ctrl or Cmd key is pressed
      if (window && (event.ctrlKey || event.metaKey)) {
        // Convert the navigate function to a string
        const navigateStr = String(navigate);

        // Use regex to extract the path pattern
        const pathMatch = navigateStr.match(/navigate\(`([^`]+)`\)/);

        if (pathMatch && pathMatch[1]) {
          // Replace any ${id} in the path with the actual item.id
          const pathTemplate = pathMatch[1];
          // eslint-disable-next-line no-template-curly-in-string
          const path = pathTemplate.replace("${id}", item.id);

          // Use origin to get the base URL without path components
          window.open(window.location.origin + path);
        } else {
          // Fallback to the original approach if regex fails
          window.open(window.location.href + "/" + item.id);
        }
        return;
      }

      // Call the navigate function if it exists
      void navigate(item.id, item);
    }
  };

  const sharedClassName = tw(
    "hover:bg-gray-50",
    navigate ? "cursor-pointer" : "",
    className
  );

  // Only use framer-motion when animations are actually needed (e.g. kit expand/collapse).
  // The vast majority of rows (asset index) don't animate, so we skip the overhead.
  if (motionProps) {
    return (
      <motion.tr
        onClick={handleClick}
        className={sharedClassName}
        style={CHROMIUM_HOVER_FIX}
        {...motionProps}
      >
        {children}
      </motion.tr>
    );
  }

  return (
    <tr
      onClick={handleClick}
      className={sharedClassName}
      style={CHROMIUM_HOVER_FIX}
    >
      {children}
    </tr>
  );
});
