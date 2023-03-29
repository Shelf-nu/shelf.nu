import { Link } from "@remix-run/react";

export interface ListItemData {
  id: string;
  title: string;
}
export const ListItem = ({ item }: { item: ListItemData }) => (
  <article key={item.id} className="border-b last:border-b-0 hover:bg-gray-50 ">
    <Link className={`block px-6 py-4`} to={item.id}>
      <article className="flex gap-3">
        <img
          src="/images/placeholder-square.png"
          className=" h-10 w-10 rounded-[4px] border"
          alt="item placeholder"
        />
        <div className="flex flex-col">
          <div className="font-medium">{item.title}</div>
          <div className="text-gray-600">{item.id}</div>
        </div>
      </article>
    </Link>
  </article>
);
