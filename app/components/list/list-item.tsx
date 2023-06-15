import { useNavigate } from "@remix-run/react";

export interface ListItemData {
  id: string;
  title: string;
  mainImage: string;
}
export const ListItem = ({
  item,
  children,
}: {
  item: ListItemData;
  children: React.ReactNode;
}) => {
  const navigate = useNavigate();
  return (
    <tr
      key={item.id}
      onClick={() => navigate(item.id)}
      className="cursor-pointer hover:bg-gray-50"
    >
      {children}
    </tr>
  );
};
