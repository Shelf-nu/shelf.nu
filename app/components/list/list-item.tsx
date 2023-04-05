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
}) => (
  <article
    key={item.id}
    className="border-b px-6 py-4 last:border-b-0 hover:bg-gray-50"
  >
    {children}
  </article>
);
