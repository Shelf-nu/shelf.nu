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
