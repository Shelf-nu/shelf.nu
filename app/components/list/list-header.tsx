import type { ListItemData } from "./list-item";

interface ListHeaderProps {
  items: ListItemData[];
  totalItems: number;
  modelName: {
    singular: string;
    plural: string;
  };
  perPage: number;
}

export const ListHeader = ({ items, totalItems, perPage, modelName }: ListHeaderProps) => {
  // const { items, totalItems, perPage, modelName } =
  //   useLoaderData<IndexResponse>();
  const { singular, plural } = modelName;

  return (
    <div className=" flex justify-between border-b px-6 py-[14px] text-gray-600">
      <div>
        {perPage < totalItems ? (
          <p>
            {items.length} {items.length > 1 ? plural : singular}{" "}
            <span className="text-gray-400">out of {totalItems}</span>
          </p>
        ) : (
          <span>
            {totalItems} {items.length > 1 ? plural : singular}
          </span>
        )}
      </div>
      {singular === "checklist" ? <div><span>Last Check</span></div> : ""}
    </div>
  );
};
