import type { Checklist } from "@prisma/client";
import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import type { ListItemData } from "~/components/list/list-item";
import { Button } from "~/components/shared";
import { requireAuthSession } from "~/modules/auth";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  const title = "Checklists";
  const header = {
    title,
  };
  return json({ header });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.header.title) },
];

export default function ItemIndexPage() {
  const items: ListItemData[] = [
    {
      id: "1",
      title: "General Lighting Equipment",
      mainImage: "/images/item-placeholder.png",
      checklistLength: 23,
      updatedAt: "05-05-2023",
    },
    {
      id: "2",
      title: "Threeway Camera Production",
      mainImage: "/images/item-placeholder.png",
      checklistLength: 39,
      updatedAt: "03 -05-2023",
    },
    {
      id: "3",
      title: "In-House Workstations",
      mainImage: "/images/item-placeholder.png",
      checklistLength: 23,
      updatedAt: "01-05-2023",
    },
    {
      id: "4",
      title: "Camera Equipment",
      mainImage: "/images/item-placeholder.png",
      checklistLength: 13,
      updatedAt: "01-05-2023",
    },
  ];
  const totalItems = 4;
  const perPage = 8;
  const modelName = {
    singular: "checklist",
    plural: "checklists",
  };
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
          items={items}
          totalItems={totalItems}
          perPage={perPage}
          modelName={modelName}
          search={null}
          page={1}
          totalPages={1}
          next=""
          prev=""
        />
      </div>
    </>
  );
}

function ChecklistContent({ item }: { item: Checklist }) {
  return (
    <Link className={`block `} to={`${item.id}/checklist`}>
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
              <div className="hidden text-gray-600 md:block">
                {item.checklistLength}
              </div>
              <div className="block md:hidden">{item.updatedAt}</div>
            </div>
          </div>
          <div className="hidden md:block">{item.updatedAt}</div>
        </div>
      </article>
    </Link>
  );
}
