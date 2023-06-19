import type { Checklist } from "@prisma/client";
import { MinusSquareIcon, TrashIcon } from "~/components/icons";
import { List } from "~/components/list";
import { Badge } from "~/components/shared";

export default function ChecklistHistory() {
  const items = [
    {
      id: "1",
      date: "Jan 6, 2022",
      isCompleted: false,
      totalItems: 8,
      completedItems: 4,
    },
    {
      id: "2",
      date: "Jan 6, 2022",
      isCompleted: true,
      totalItems: 8,
      completedItems: 8,
    },
    {
      id: "3",
      date: "Jan 6, 2022",
      isCompleted: true,
      totalItems: 8,
      completedItems: 8,
    },
    {
      id: "4",
      date: "Jan 5, 2022",
      isCompleted: true,
      totalItems: 8,
      completedItems: 8,
    },
  ];
  return (
    <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
      <List
        ItemComponent={ChecklistContent}
        items={items}
        CustomHeader={ChecklistHeader}
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

function ChecklistContent({ item }: { item: any }) {
  return (
    <article className="flex gap-3">
      <div className="flex w-full items-center justify-between gap-3">
        <div>
          <span>{item.date}</span>
        </div>
        <div className="flex gap-12">
          <Badge color="#027A48">Completed</Badge>
          <Badge color="#027A48">8/8</Badge>
        </div>
      </div>
    </article>
  );
}

function ChecklistHeader() {
  return (
    <div className="custom-list-header">
      <div>
        <span>Date</span>
      </div>
      <div className="flex gap-12">
        <span>Status</span>
        <span>Result</span>
      </div>
    </div>
  );
}
