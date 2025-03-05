import { Roles } from "@prisma/client";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, NavLink, Outlet, useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { ScanBarcodeIcon } from "lucide-react";
import { ClientOnly } from "remix-utils/client-only";
import { switchingWorkspaceAtom } from "~/atoms/switching-workspace";
import { ErrorContent } from "~/components/errors";

import { InstallPwaPromptModal } from "~/components/layout/install-pwa-prompt-modal";
import AppSidebar from "~/components/layout/sidebar/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/layout/sidebar/sidebar";
import { useCrisp } from "~/components/marketing/crisp";
import { ShelfMobileLogo } from "~/components/marketing/logos";
import { Spinner } from "~/components/shared/spinner";
import { Toaster } from "~/components/shared/toast";
import { NoSubscription } from "~/components/subscription/no-subscription";
import { config } from "~/config/shelf.config";
import { getSelectedOrganisation } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/index.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  installPwaPromptCookie,
  initializePerPageCookieOnLayout,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";

import {
  disabledTeamOrg,
  getCustomerActiveSubscription,
  getStripeCustomer,
  stripe,
} from "~/utils/stripe.server";
import { canUseBookings } from "~/utils/subscription.server";
import { tw } from "~/utils/tw";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export type LayoutLoaderResponse = typeof loader;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const user = await getUserByID(userId, {
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
          id: true,
          organization: true,
          roles: true,
        },
      },
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
    const userPrefsCookie = await initializePerPageCookieOnLayout(request);

    const cookieHeader = request.headers.get("Cookie");
    const pwaPromptCookie =
      (await installPwaPromptCookie.parse(cookieHeader)) || {};

    if (!user.onboarded) {
      return redirect("onboarding");
    }

    /** There could be a case when you get removed from an organization while browsing it.
     * In this case what we do is we set the current organization to the first one in the list
     */
    const { organizationId, organizations, currentOrganization } =
      await getSelectedOrganisation({ userId: authSession.userId, request });
    const isAdmin = user?.roles.some((role) => role.name === Roles["ADMIN"]);

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
        hideNoticeCard: userPrefsCookie.hideNoticeCard,
        minimizedSidebar: userPrefsCookie.minimizedSidebar,
        scannerCameraId: userPrefsCookie.scannerCameraId,
        hideInstallPwaPrompt: pwaPromptCookie.hidden,
        isAdmin,
        canUseBookings: canUseBookings(currentOrganization),
        /** THis is used to disable team organizations when the currentOrg is Team and no subscription is present  */
        disabledTeamOrg: isAdmin
          ? false
          : currentOrganization.workspaceDisabled ||
            (await disabledTeamOrg({
              currentOrganization,
              organizations,
              url: request.url,
            })),
      }),
      {
        headers: [setCookie(await userPrefs.serialize(userPrefsCookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId: authSession.userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ error }) => [
  /** This will make sure that if we have an error its visible in the title of the browser tab */
  // @ts-expect-error
  { title: error ? appendToMetaTitle(error.data.error.title) : "" },
];

export default function App() {
  useCrisp();
  const { disabledTeamOrg, minimizedSidebar } = useLoaderData<typeof loader>();
  const workspaceSwitching = useAtomValue(switchingWorkspaceAtom);

  const renderInstallPwaPromptOnMobile = () =>
    // returns InstallPwaPromptModal if the device width is lesser than 640px and the app is being accessed from browser not PWA
    window.matchMedia("(max-width: 640px)").matches &&
    !window.matchMedia("(display-mode: standalone)").matches ? (
      <InstallPwaPromptModal />
    ) : null;

  return (
    <SidebarProvider defaultOpen={!minimizedSidebar}>
      <AppSidebar />
      <SidebarInset>
        {disabledTeamOrg ? (
          <NoSubscription />
        ) : workspaceSwitching ? (
          <div className="flex size-full flex-col items-center justify-center text-center">
            <Spinner />
            <p className="mt-2">Activating workspace...</p>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b bg-white py-4 md:hidden">
              <Link to="." title="Home" className="block h-8">
                <ShelfMobileLogo />
              </Link>
              <div className="flex items-center space-x-2">
                <NavLink
                  to="/scanner"
                  title="Scan QR Code"
                  className={({ isActive }) =>
                    tw(
                      "relative flex items-center justify-center px-2 transition",
                      isActive ? "text-primary-600" : "text-gray-500"
                    )
                  }
                >
                  <ScanBarcodeIcon />
                </NavLink>
                <SidebarTrigger />
              </div>
            </header>
            <Outlet />
          </>
        )}
        <Toaster />
        <ClientOnly fallback={null}>
          {renderInstallPwaPromptOnMobile}
        </ClientOnly>
      </SidebarInset>
    </SidebarProvider>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
