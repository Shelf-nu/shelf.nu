import type { User } from "@prisma/client";
import { TierId, OrganizationRoles, OrganizationType } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useNavigate, useLoaderData } from "react-router";
import type Stripe from "stripe";
import { StatusFilter } from "~/components/booking/status-filter";
import { ErrorContent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Pagination } from "~/components/list/pagination";
import { DateS } from "~/components/shared/date";
import { Td, Th } from "~/components/table";
import { config } from "~/config/shelf.config";
import { getPaginatedAndFilterableUsers } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";
import {
  getStripeCustomer,
  getOrCreateCustomerId,
} from "~/utils/stripe.server";

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
              const subscription = customer?.subscriptions?.data?.[0] || null;
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

type UserWithSubscription = Awaited<ReturnType<typeof loader>>["items"][number];

/**
 * Determines account status prioritizing team workspaces over personal ones.
 * Admins need to see billing-relevant status for conversion tracking.
 */
function getAccountStatus(user: UserWithSubscription): string {
  // Priority 1: Team workspace owner (billing decision maker)
  const teamOrgWhereOwner = user.userOrganizations.find(
    (uo) =>
      uo.organization.type === OrganizationType.TEAM &&
      (uo.roles.includes(OrganizationRoles.OWNER) ||
        uo.organization.userId === user.id)
  );

  if (teamOrgWhereOwner) {
    return formatOwnerStatus(user);
  }

  // Priority 2: Team workspace member (invited user)
  const teamOrgWhereMember = user.userOrganizations.find(
    (uo) =>
      uo.organization.type === OrganizationType.TEAM &&
      !uo.roles.includes(OrganizationRoles.OWNER)
  );

  if (teamOrgWhereMember) {
    return formatMemberStatus(user);
  }

  // Priority 3: Personal workspace only - check if they're on Plus
  if (user.tierId === TierId.tier_1) {
    return "Owner (Paid - Plus)";
  }

  return "Owner (Free)";
}

function formatOwnerStatus(user: UserWithSubscription): string {
  // Note: This function is only called for team workspace owners

  // Check if on trial
  const isTrial =
    user.subscription?.status === "trialing" && !!user.subscription?.trial_end;

  if (isTrial && user.subscription?.trial_end) {
    const trialEndDate = new Date(user.subscription.trial_end * 1000);
    const formattedDate = trialEndDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return `Owner (Trial - ends ${formattedDate})`;
  }

  // Paid tiers (typical for team workspace owners)
  if (user.tierId === TierId.tier_1) return "Owner (Paid - Plus)";
  if (user.tierId === TierId.tier_2) return "Owner (Paid - Team)";
  if (user.tierId === TierId.custom) return "Owner (Paid - Custom)";

  // Fallback for edge cases (team workspace created but not yet paid)
  return "Owner (Free)";
}

function formatMemberStatus(user: UserWithSubscription): string {
  // Check if team is on trial
  const isTrial =
    user.subscription?.status === "trialing" && !!user.subscription?.trial_end;

  if (isTrial) {
    return "Member (Invited to trial)";
  }

  // Member of paid team
  if (user.tierId !== TierId.free) {
    return "Member (Invited to paid)";
  }

  // Member invited but team not yet paid
  return "Member (Invited to team)";
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
              <Th>Account Status</Th>
              <Th>Created at</Th>
            </>
          }
        />
      </div>
    </div>
  );
}

const ListUserContent = ({ item }: { item: UserWithSubscription }) => (
  <>
    <Td>
      {item.firstName} {item.lastName}
    </Td>
    <Td>{item.email}</Td>
    <Td>
      <span className="capitalize">{item.tier.name}</span>
    </Td>
    <Td>{getAccountStatus(item)}</Td>
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
