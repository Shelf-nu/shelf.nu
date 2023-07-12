import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { MinusSquareIcon, TrashIcon } from "~/components/icons";
import { List } from "~/components/list";
import { Badge } from "~/components/shared";
import { Td, Th } from "~/components/table";
import { requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  const title = "Checklist";
  const header = {
    title,
  };
  const items: any[] = [
    {
      id: "S349a002e",
      title: "General Lighting Equipment",
      mainImage: "/images/asset-placeholder.jpg",
    },
    {
      id: "S349a002f",
      title: "Threeway Camera Production",
      mainImage: "/images/asset-placeholder.jpg",
    },
    {
      id: "S349a002g",
      title: "In-House Workstations",
      mainImage: "/images/asset-placeholder.jpg",
    },
    {
      id: "S349a002h",
      title: "Camera Equipment",
      mainImage: "/images/asset-placeholder.jpg",
    },
  ];
  const totalItems = 4;
  const perPage = 8;
  const page = 1;
  const prev = "";
  const next = "";
  const totalPages = 1;
  const modelName = {
    singular: "checklist",
    plural: "checklists",
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

export default function InspectChecklist() {
  return (
    <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
      <List
        ItemComponent={ChecklistContent}
        headerChildren={
          <>
            <Th className="hidden md:table-cell">Category</Th>
            <Th className="hidden md:table-cell"> </Th>
          </>
        }
      />
    </div>
  );
}

function ChecklistContent({ item }: { item: any }) {
  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center">
              <img
                src={item.mainImage}
                alt="img"
                className="h-10 w-10 rounded-[4px] object-cover"
              />
            </div>
            <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
              <div className="font-medium">{item.title}</div>
            </div>
          </div>

          <button className="block md:hidden">
            <TrashIcon />
          </button>
        </div>
      </Td>
      <Td className="hidden md:table-cell">
        <Badge color="#175CD3">office</Badge>
      </Td>
      <Td className="hidden text-left md:table-cell">
        <MinusSquareIcon />
      </Td>
    </>
  );
}
