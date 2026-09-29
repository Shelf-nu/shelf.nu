import { TierId } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useNavigate, useLoaderData } from "react-router";
import { StatusFilter } from "~/components/booking/status-filter";
import { ErrorContent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Pagination } from "~/components/list/pagination";
import { DateS } from "~/components/shared/date";
import { Td, Th } from "~/components/table";
import { config } from "~/config/shelf.config";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import type { SubscriptionForAccountStatus } from "~/modules/user/account-status";
import { getAccountStatus } from "~/modules/user/account-status";
import { getPaginatedAndFilterableUsers } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";
import { getStripeCustomer } from "~/utils/stripe.server";
import { resolveUserDisplayName } from "~/utils/user";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    const { search, totalUsers, perPage, page, users, totalPages, tierId } =
      await getPaginatedAndFilterableUsers({
        request,
      });

    const premiumIsEnabled = config.enablePremiumFeatures;

    // Fetch Stripe subscription data for users with customerId
    // Note: This takes the first subscription which may not always be the
    // active/relevant one if a user has multiple subscriptions
    const usersWithSubscriptions = premiumIsEnabled
      ? await Promise.all(
          users.map(async (user) => {
            if (!user.customerId) {
              return { ...user, subscription: null };
            }

            try {
              const customer = await getStripeCustomer(user.customerId);
              // Check if customer is not deleted before accessing subscriptions
              // (DeletedCustomer type doesn't have subscriptions property)
              const subscription =
                customer && "subscriptions" in customer
                  ? customer.subscriptions?.data?.[0] || null
                  : null;
              return { ...user, subscription };
            } catch {
              return { ...user, subscription: null };
            }
          })
        )
      : users.map((user) => ({ ...user, subscription: null }));

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
      items: usersWithSubscriptions,
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

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: loaderData ? appendToMetaTitle(loaderData.header.title) : "" },
];

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
              <Th>Account Status</Th>
              <Th>Created at</Th>
            </>
          }
        />
      </div>
    </div>
  );
}

/**
 * One row of the admin user list: what the service selects, plus the Stripe
 * subscription the loader attaches per user.
 */
type UserWithSubscription = Awaited<
  ReturnType<typeof getPaginatedAndFilterableUsers>
>["users"][number] & { subscription: SubscriptionForAccountStatus };

const ListUserContent = ({ item }: { item: UserWithSubscription }) => {
  // Trial-end labels in the account status are formatted via the acting
  // admin's resolved date-format prefs (no hardcoded en-US).
  const { prefs } = useDateFormatter();
  return (
    <>
      <Td>{resolveUserDisplayName(item)}</Td>
      <Td>{item.email}</Td>
      <Td>
        <span className="capitalize">{item.tier.name}</span>
      </Td>
      <Td>{getAccountStatus(item, prefs)}</Td>
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
};

export const ErrorBoundary = () => <ErrorContent />;
