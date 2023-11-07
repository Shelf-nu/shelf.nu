import { useMemo } from "react";
import type { Organization, User } from "@prisma/client";
import { redirect, type LoaderFunctionArgs, json } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { Pagination } from "~/components/list/pagination";
import { Td, Th } from "~/components/table";
import { getPaginatedAndFilterableOrganizations } from "~/modules/organization";
import { isPersonalOrg } from "~/utils/organization";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const {
    search,
    totalOrganizations,
    perPage,
    page,
    prev,
    next,
    organizations,
    totalPages,
  } = await getPaginatedAndFilterableOrganizations({
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
    items: organizations,
    search,
    page,
    totalItems: totalOrganizations,
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
          headerChildren={
            <>
              <Th>Name</Th>
              <Th>Owner Email</Th>
              <Th>Type</Th>
            </>
          }
          ItemComponent={ListUserContent}
          navigate={(itemId) => navigate(itemId)}
        />
      </div>
    </div>
  );
}

const ListUserContent = ({
  item,
}: {
  item: Organization & {
    owner: User;
  };
}) => {
  const isPersonal = useMemo(() => isPersonalOrg(item), [item]);

  return (
    <>
      <Td> </Td>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          {isPersonal
            ? `${item.owner.firstName} ${item.owner.lastName}`
            : item.name}
        </div>
      </Td>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          {item.owner.email}
        </div>
      </Td>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          {item.type}
        </div>
      </Td>
    </>
  );
};

export const ErrorBoundary = () => <ErrorBoundryComponent />;
