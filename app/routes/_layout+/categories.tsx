import { json, type LoaderArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { Button } from "~/components/shared/button";

import { requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  const header: HeaderData = {
    title: "Categories",
  };
  const modelName = {
    singular: "category",
    plural: "categories",
  };

  return json({ header, modelName });
}

export const handle = {
  breadcrumb: () => <Link to="/categories">Categories</Link>,
};

export default function CategoriesPage() {
  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new category`}
          icon="plus"
          data-test-id="createNewCategory"
        >
          New Category
        </Button>
      </Header>
      <div className="mt-8 flex flex-1 flex-col gap-2">
        <Filters />
        <Outlet />
        <List />
      </div>
    </>
  );
}
