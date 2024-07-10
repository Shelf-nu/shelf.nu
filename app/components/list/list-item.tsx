import { tw } from "~/utils/tw";

export interface ListItemData {
  id: string;
  [x: string]: any;
}

export const ListItem = ({
  item,
  children,
  navigate,
  className,
}: {
  item: ListItemData;
  children: React.ReactNode;
  navigate?: (id: string, item: ListItemData) => void;
  className?: string;
}) => (
  <tr
    onClick={navigate ? () => navigate(item.id, item) : undefined}
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
  >
    {children}
  </tr>
);
