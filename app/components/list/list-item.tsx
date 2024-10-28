import type { MotionProps } from "framer-motion";
import { motion } from "framer-motion";
import { tw } from "~/utils/tw";

export interface ListItemData {
  id: string;
  [x: string]: any;
}

export interface ListItemProps {
  item: ListItemData;
  children: React.ReactNode;
  navigate?: (id: string, item: ListItemData) => void;
  className?: string;
  motionProps?: MotionProps; // Optional animation props passed to the motion component
}

export const ListItem = ({
  item,
  children,
  navigate,
  className,
  motionProps = {},
}: ListItemProps) => (
  <motion.tr
    onClick={(event) => {
      if (navigate) {
        // Check if Ctrl or Cmd key is pressed
        if (window && (event.ctrlKey || event.metaKey)) {
          window.open(window.location.href + "/" + item.id);
          return;
        }

        // Call the navigate function if it exists
        navigate(item.id, item);
      }
    }}
    className={tw(
      "hover:bg-gray-50",
      navigate ? "cursor-pointer" : "",
      className
    )}
    /**
     * Chromium based browsers have a bug since 2014 that is related to
     * hover effects on table rows while scrolling.
     *  We add the following styles to fix the issue.
     */
    style={{
      transform: "translateZ(0)",
      willChange: "transform",
      backgroundAttachment: "initial",
    }}
    {...motionProps}
  >
    {children}
  </motion.tr>
);
