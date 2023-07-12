import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { ChevronRight } from "~/components/icons";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import { Button } from "~/components/shared";
import { Td, Th } from "~/components/table";
import { requireAuthSession } from "~/modules/auth";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  const title = "Checklists";
  const header = {
    title,
  };
  const items: any[] = [
    {
      id: "1",
      title: "General Lighting Equipment",
      mainImage: "/images/asset-placeholder.jpg",
      checklistLength: 23,
      updatedAt: "05-05-2023",
    },
    {
      id: "2",
      title: "Threeway Camera Production",
      mainImage: "/images/asset-placeholder.jpg",
      checklistLength: 39,
      updatedAt: "03 -05-2023",
    },
    {
      id: "3",
      title: "In-House Workstations",
      mainImage: "/images/asset-placeholder.jpg",
      checklistLength: 23,
      updatedAt: "01-05-2023",
    },
    {
      id: "4",
      title: "Camera Equipment",
      mainImage: "/images/asset-placeholder.jpg",
      checklistLength: 13,
      updatedAt: "01-05-2023",
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

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function ItemIndexPage() {
  const navigate = useNavigate();
  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new item`}
          icon="plus"
          data-test-id="createNewItem"
        >
          Checklist
        </Button>
      </Header>
      <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
        <List
          ItemComponent={ChecklistContent}
          navigate={(itemId) => navigate(itemId)}
          headerChildren={
            <>
              <Th className="hidden md:table-cell">Last Check</Th>
            </>
          }
        />
      </div>
    </>
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
              <div className="hidden text-gray-600 md:block">
                {item.checklistLength} items
              </div>
              <div className="block md:hidden">{item.updatedAt}</div>
            </div>
          </div>

          <button className="block md:hidden">
            <ChevronRight />
          </button>
        </div>
      </Td>
      <Td className="hidden md:table-cell">{item.updatedAt}</Td>
    </>
  );
}
