import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { List } from "~/components/list";
import { Badge } from "~/components/shared";
import { Td, Th } from "~/components/table";
import { requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  const title = "Checklists History";
  const header = {
    title,
  };
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
  const totalItems = 4;
  const perPage = 8;
  const page = 1;
  const prev = "";
  const next = "";
  const totalPages = 1;
  const modelName = {
    singular: "date",
    plural: "dates",
  };
  return json({
    header,
    items,
    totalItems,
    page,
    prev,
    next,
    perPage,
    totalPages,
    modelName,
  });
}

export default function ChecklistHistory() {
  return (
    <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
      <List
        ItemComponent={RowContent}
        headerChildren={
          <>
            <Th>Status</Th>
            <Th>Result</Th>
          </>
        }
      />
    </div>
  );
}

function RowContent({ item }: { item: any }) {
  return (
    <>
      <Td className="w-full">
        <div className="font-medium">{item.date}</div>
      </Td>
      <Td>
        <Badge color="#027A48">Completed</Badge>
      </Td>
      <Td className="text-left">
        <Badge color="#027A48">8/8</Badge>
      </Td>
    </>
  );
}
