import { Roles } from "@prisma/client";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";

import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import Sidebar from "~/components/layout/sidebar/sidebar";
import { useCrisp } from "~/components/marketing/crisp";
import { Toaster } from "~/components/shared/toast";
import { db } from "~/database";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import styles from "~/styles/layout/index.css";
import { ENABLE_PREMIUM_FEATURES } from "~/utils";
import {
  initializePerPageCookieOnLayout,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";

import {
  getCustomerActiveSubscription,
  getStripeCustomer,
  stripe,
} from "~/utils/stripe.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const authSession = await requireAuthSession(request);
  // @TODO - we need to look into doing a select as we dont want to expose all data always
  const user = authSession
    ? await db.user.findUnique({
        where: { email: authSession.email.toLowerCase() },
        include: {
          roles: true,
          organizations: {
            select: {
              id: true,
              name: true,
              type: true,
              imageId: true,
            },
          },
          userOrganizations: {
            where: {
              userId: authSession.userId,
            },
            select: {
              organization: true,
            },
          },
        },
      })
    : undefined;
  let subscription = null;
  if (user?.customerId && stripe) {
    // Get the Stripe customer
    const customer = (await getStripeCustomer(
      user.customerId
    )) as CustomerWithSubscriptions;
    /** Find the active subscription for the Stripe customer */
    subscription = getCustomerActiveSubscription({ customer });
  }

  const cookie = await initializePerPageCookieOnLayout(request);

  if (!user?.onboarded) {
    return redirect("onboarding");
  }

  /** There could be a case when you get removed from an organization while browsing it.
   * In this case what we do is we set the current organization to the first one in the list
   */
  const { organizationId, organizations } = await requireOrganisationId(
    authSession,
    request
  );

  return json(
    {
      user,
      organizations,
      currentOrganizationId: organizationId,
      subscription,
      enablePremium: ENABLE_PREMIUM_FEATURES,
      hideSupportBanner: cookie.hideSupportBanner,
      minimizedSidebar: cookie.minimizedSidebar,
      isAdmin: user?.roles.some((role) => role.name === Roles["ADMIN"]),
    },
    {
      headers: [
        setCookie(await userPrefs.serialize(cookie)),
        setCookie(
          await commitAuthSession(request, {
            authSession,
          })
        ),
      ],
    }
  );
};

export default function App() {
  useCrisp();

  return (
    <div id="container" className="flex min-h-screen min-w-[320px] flex-col">
      <div className="flex flex-col md:flex-row">
        <Sidebar />
        <main className=" flex-1 bg-gray-25 px-4 py-8 md:w-[calc(100%-312px)] md:px-8">
          <div className="flex h-full flex-1 flex-col">
            <Breadcrumbs />
            <Outlet />
          </div>
          <Toaster />
        </main>
      </div>
    </div>
  );
}

export const ErrorBoundary = () => (
  <ErrorBoundryComponent title="Sorry, page you are looking for doesn't exist" />
);
