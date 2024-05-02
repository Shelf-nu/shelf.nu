import { Link, type LinkProps } from "@remix-run/react";

export interface ListItemData {
  id: string;
}

export type ListItemProps = {
  item: ListItemData;
  children: React.ReactNode;
  link?: ((itemId: string) => LinkProps) | null;
  onClick?: ((itemId: string) => void) | null;
};

export const ListItem = ({
  item,
  children,
  link = null,
  onClick,
}: ListItemProps) => (
  <tr
    key={item.id}
    className="hover:bg-gray-50"
    onClick={() => {
      onClick && onClick(item.id);
    }}
  >
    {link ? (
      <Link
        {...link(item.id)}
        className="m-0 contents w-full border p-0 align-middle"
      >
        {children}
      </Link>
    ) : (
      children
    )}
  </tr>
);
