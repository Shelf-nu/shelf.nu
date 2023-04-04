import { Link } from "@remix-run/react";
import { ItemImage } from "../items/item-image";

export interface ListItemData {
  id: string;
  title: string;
  mainImage: string;
}
export const ListItem = ({ item }: { item: ListItemData }) => (
  <article key={item.id} className="border-b last:border-b-0 hover:bg-gray-50 ">
    <Link className={`block px-6 py-4`} to={item.id}>
      <article className="flex gap-3">
        <ItemImage
          item={{
            itemId: item.id,
            mainImage: item.mainImage,
            // @ts-ignore
            mainImageExpiration: item.mainImageExpiration,
            alt: item.title,
          }}
          className="h-10 w-10 rounded-[4px] object-cover"
        />

        <div className="flex flex-col">
          <div className="font-medium">{item.title}</div>
          <div className="text-gray-600">{item.id}</div>
        </div>
      </article>
    </Link>
  </article>
);
