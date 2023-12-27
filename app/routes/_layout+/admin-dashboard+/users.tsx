import type { User } from "@prisma/client";
import { redirect, type LoaderFunctionArgs, json } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { Pagination } from "~/components/list/pagination";
import { Td } from "~/components/table";
import { getPaginatedAndFilterableUsers } from "~/modules/user";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const { search, totalUsers, perPage, page, prev, next, users, totalPages } =
    await getPaginatedAndFilterableUsers({
      request,
    });

  if (page > totalPages) {
    return redirect("/admin-dashboard");
  }

  const header: HeaderData = {
    title: `Admin dashboard`,
  };

  const modelName = {
    singular: "user",
    plural: "users",
  };

  return json({
    header,
    items: users,
    search,
    page,
    totalItems: totalUsers,
    perPage,
    totalPages,
    next,
    prev,
    modelName,
  });
};

export default function Area51() {
  const navigate = useNavigate();
  return (
    <div>
      <h1>Admin dashboard</h1>
      <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
        <Filters>
          <Pagination />
        </Filters>
        <List
          ItemComponent={ListUserContent}
          navigate={(itemId) => navigate(`../${itemId}`)}
        />
      </div>
    </div>
  );
}

const ListUserContent = ({ item }: { item: User }) => (
  <>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        {item.email}
      </div>
    </Td>
  </>
);

export const ErrorBoundary = () => <ErrorBoundryComponent />;
