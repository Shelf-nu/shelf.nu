import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { Button } from "~/components/shared";
import { requireAuthSession } from "~/modules/auth";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  const header: HeaderData = {
    title: "Camera Equipment",
    subHeading: "This is the description given to this particular checklist",
  };
  return json({ header });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.header.title) },
];

export const handle = {
  breadcrumb: () => <span>Camera Equipment</span>,
};

export default function ItemDetailsPage() {
  const items = [
    { to: "checklist", content: "Checklist" },
    { to: "history", content: "History" },
  ];
  return (
    <>
      <Header>
        <Button to="#" role="link" variant="secondary">
          Edit
        </Button>
        <Button to="#" role="link">
          Perform Check
        </Button>
      </Header>
      <HorizontalTabs items={items} />
      <div>
        <Outlet />
      </div>
    </>
  );
}
