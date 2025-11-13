import type { User } from "@prisma/client";
import { TierId } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data , useNavigate, useLoaderData } from "react-router";
import { StatusFilter } from "~/components/booking/status-filter";
import { ErrorContent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Pagination } from "~/components/list/pagination";
import { DateS } from "~/components/shared/date";
import { Td, Th } from "~/components/table";
import { getPaginatedAndFilterableUsers } from "~/modules/user/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    const { search, totalUsers, perPage, page, users, totalPages, tierId } =
      await getPaginatedAndFilterableUsers({
        request,
      });

    const header: HeaderData = {
      title: `Admin dashboard`,
    };

    const modelName = {
      singular: "user",
      plural: "users",
    };

    const tierItems = {
      free: TierId.free,
      tier_1: TierId.tier_1,
      tier_2: TierId.tier_2,
      custom: TierId.custom,
    };

    return payload({
      header,
      items: users,
      search,
      page,
      totalItems: totalUsers,
      perPage,
      totalPages,
      modelName,
      tierId,
      tierItems,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function Area51() {
  const navigate = useNavigate();
  const { tierItems } = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Admin dashboard</h1>
      <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
        <Filters
          slots={{
            "left-of-search": (
              <StatusFilter statusItems={tierItems} name="tierId" />
            ),
          }}
        >
          <Pagination className="flex-nowrap" />
        </Filters>
        <List
          ItemComponent={ListUserContent}
          navigate={(itemId) => navigate(`../${itemId}`)}
          headerChildren={
            <>
              <Th>Email</Th>
              <Th>Tier</Th>
              <Th>Created at</Th>
            </>
          }
        />
      </div>
    </div>
  );
}

const ListUserContent = ({
  item,
}: {
  item: User & { tier: { name: string } };
}) => (
  <>
    <Td>
      {item.firstName} {item.lastName}
    </Td>
    <Td>{item.email}</Td>
    <Td>
      <span className="capitalize">{item.tier.name}</span>
    </Td>
    <Td>
      <DateS
        date={item.createdAt}
        options={{
          dateStyle: "short",
          timeStyle: "long",
        }}
      />
    </Td>
  </>
);

export const ErrorBoundary = () => <ErrorContent />;
