import { tw } from "~/utils/tw";

export interface ListItemData {
  id: string;
  [x: string]: any;
}

export const ListItem = ({
  item,
  children,
  navigate,
}: {
  item: ListItemData;
  children: React.ReactNode;
  navigate?: (id: string, item: ListItemData) => void;
}) => (
  <tr
    key={item.id}
    onClick={navigate ? () => navigate(item.id, item) : undefined}
    className={tw("hover:bg-gray-50", navigate ? "cursor-pointer" : "")}
  >
    {children}
  </tr>
);
