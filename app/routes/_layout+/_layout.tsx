import { OrganizationType, Roles } from "@prisma/client";
import type {
  LinksFunction,
  LoaderArgs,
  LoaderFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import Sidebar from "~/components/layout/sidebar/sidebar";
import { useCrisp } from "~/components/marketing/crisp";
import { Toaster } from "~/components/shared/toast";
import { userPrefs } from "~/cookies";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import styles from "~/styles/layout/index.css";
import { ENABLE_PREMIUM_FEATURES } from "~/utils";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";
import {
  getCustomerActiveSubscription,
  getStripeCustomer,
} from "~/utils/stripe.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader: LoaderFunction = async ({ request }: LoaderArgs) => {
  const authSession = await requireAuthSession(request);
  // @TODO - we need to look into doing a select as we dont want to expose all data always
  const user = authSession
    ? await db.user.findUnique({
        where: { email: authSession.email.toLowerCase() },
        include: {
          roles: true,
          organizations: {
            where: {
              // This is default for now. Will need to be adjusted when we have more org types and teams functionality is active
              type: OrganizationType.PERSONAL,
            },
            select: {
              id: true,
            },
          },
        },
      })
    : undefined;
  let subscription = null;
  if (user?.customerId) {
    // Get the Stripe customer
    const customer = (await getStripeCustomer(
      user.customerId
    )) as CustomerWithSubscriptions;
    /** Find the active subscription for the Stripe customer */
    subscription = getCustomerActiveSubscription({ customer });
  }

  const cookieHeader = request.headers.get("Cookie");
  const cookie = (await userPrefs.parse(cookieHeader)) || {};
  if (!user?.onboarded) {
    return redirect("onboarding");
  }

  return json({
    user,
    organizationId: user?.organizations[0].id,
    subscription,
    enablePremium: ENABLE_PREMIUM_FEATURES,
    hideSupportBanner: cookie.hideSupportBanner,
    minimizedSidebar: cookie.minimizedSidebar,
    isAdmin: user?.roles.some((role) => role.name === Roles["ADMIN"]),
  });
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
