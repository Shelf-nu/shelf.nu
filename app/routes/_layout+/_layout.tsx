import { Roles } from "@prisma/client";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { useAtom } from "jotai";
import { switchingWorkspaceAtom } from "~/atoms/switching-workspace";
import { ErrorContent } from "~/components/errors";

import Sidebar from "~/components/layout/sidebar/sidebar";
import { useCrisp } from "~/components/marketing/crisp";
import { Spinner } from "~/components/shared/spinner";
import { Toaster } from "~/components/shared/toast";
import { config } from "~/config/shelf.config";
import { db } from "~/database/db.server";
import { getSelectedOrganisation } from "~/modules/organization/context.server";
import styles from "~/styles/layout/index.css";
import { ShelfError, data, error, makeShelfError } from "~/utils";
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
import { canUseBookings } from "~/utils/subscription";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // @TODO - we need to look into doing a select as we dont want to expose all data always
    const user = await db.user
      .findUniqueOrThrow({
        where: { id: userId },
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
              roles: true,
            },
          },
          tier: {
            select: {
              tierLimit: true,
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "We can't find your user data. Please try again or contact support.",
          additionalData: { userId },
          label: "App layout",
        });
      });

    let subscription = null;

    if (user.customerId && stripe) {
      // Get the Stripe customer
      const customer = (await getStripeCustomer(
        user.customerId
      )) as CustomerWithSubscriptions;
      /** Find the active subscription for the Stripe customer */
      subscription = getCustomerActiveSubscription({ customer });
    }

    /** This checks if the perPage value in the user-prefs cookie exists. If it doesnt it sets it to the default value of 20 */
    const cookie = await initializePerPageCookieOnLayout(request);

    if (!user.onboarded) {
      return redirect("onboarding");
    }

    /** There could be a case when you get removed from an organization while browsing it.
     * In this case what we do is we set the current organization to the first one in the list
     */
    const { organizationId, organizations, currentOrganization } =
      await getSelectedOrganisation({ userId: authSession.userId, request });

    return json(
      data({
        user,
        organizations,
        currentOrganizationId: organizationId,
        currentOrganizationUserRoles: user?.userOrganizations.find(
          (userOrg) => userOrg.organization.id === organizationId
        )?.roles,
        subscription,
        enablePremium: config.enablePremiumFeatures,
        hideSupportBanner: cookie.hideSupportBanner,
        minimizedSidebar: cookie.minimizedSidebar,
        isAdmin: user?.roles.some((role) => role.name === Roles["ADMIN"]),
        canUseBookings: canUseBookings(currentOrganization),
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId: authSession.userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function App() {
  useCrisp();
  const { currentOrganizationId } = useLoaderData<typeof loader>();
  const [workspaceSwitching] = useAtom(switchingWorkspaceAtom);

  return (
    <>
      <div
        id="container"
        key={currentOrganizationId}
        className="flex min-h-screen min-w-[320px] flex-col"
      >
        <div className="inner-container flex flex-col md:flex-row">
          <Sidebar />
          <main className=" flex-1 bg-gray-25 px-4 pb-6 md:w-[calc(100%-312px)]">
            <div className="flex h-full flex-1 flex-col">
              {workspaceSwitching ? (
                <div className="flex size-full flex-col items-center justify-center text-center">
                  <Spinner />
                  <p className="mt-2">Activating workspace...</p>
                </div>
              ) : (
                <Outlet />
              )}
            </div>
            <Toaster />
          </main>
        </div>
      </div>
    </>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
