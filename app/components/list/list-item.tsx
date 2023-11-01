import { tw } from "~/utils";

export interface ListItemData {
  id: string;
}
export const ListItem = ({
  item,
  children,
  navigate,
}: {
  item: ListItemData;
  children: React.ReactNode;
  navigate?: (id: string) => void;
}) => (
  <tr
    key={item.id}
    onClick={navigate ? () => navigate(item.id) : undefined}
    className={tw("hover:bg-gray-50", navigate ? "cursor-pointer" : "")}
  >
    {children}
  </tr>
);
