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
    className="border-b p-4 last:border-b-0 hover:bg-gray-50 md:px-6"
  >
    {children}
  </article>
);
