import type { Checklist } from "@prisma/client";
import { MinusSquareIcon, TrashIcon } from "~/components/icons";
import { List } from "~/components/list";
import type { ListItemData } from "~/components/list/list-item";
import { Badge } from "~/components/shared";

export default function InspectChecklist() {
  const items: ListItemData[] = [
    {
      id: "S349a002e",
      title: "General Lighting Equipment",
      mainImage: "/images/item-placeholder.png",
    },
    {
      id: "S349a002f",
      title: "Threeway Camera Production",
      mainImage: "/images/item-placeholder.png",
    },
    {
      id: "S349a002g",
      title: "In-House Workstations",
      mainImage: "/images/item-placeholder.png",
    },
    {
      id: "S349a002h",
      title: "Camera Equipment",
      mainImage: "/images/item-placeholder.png",
    },
  ];
  return (
    <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
      <List
        ItemComponent={ChecklistContent}
        items={items}
        totalItems={4}
        perPage={8}
        modelName={{ singular: "item", plural: "items" }}
        search={null}
        page={1}
        totalPages={1}
        next=""
        prev=""
      />
    </div>
  );
}

function ChecklistContent({ item }: { item: Checklist }) {
  return (
    <article className="flex gap-3">
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[4px] border">
            <img
              src={item.mainImage}
              alt="img"
              className="h-10 w-10 rounded-[4px] object-cover"
            />
          </div>

          <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
            <div className="font-medium">{item.title}</div>
            <div className="hidden text-gray-600 md:block">{item.id}</div>
            <div className="block md:hidden">
              <div className="flex">
                <div className="mx-3 md:mx-6">
                  <Badge color="#175CD3">office</Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="hidden md:block">
          <div className="flex">
            <div className="mx-6">
              <Badge color="#175CD3">office</Badge>
            </div>
            <button className="ml-3 md:ml-6">
              <MinusSquareIcon />
            </button>
          </div>
        </div>
        <button className="md:hidden">
          <TrashIcon />
        </button>
      </div>
    </article>
  );
}

