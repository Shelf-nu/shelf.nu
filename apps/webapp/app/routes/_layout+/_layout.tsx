import type { Prisma } from "@prisma/client";
import { Roles } from "@prisma/client";
import { useAtom, useAtomValue } from "jotai";
import { ScanBarcodeIcon } from "lucide-react";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  data,
  redirect,
  Link,
  NavLink,
  Outlet,
  useLoaderData,
} from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { AtomsResetHandler } from "~/atoms/atoms-reset-handler";
import { feedbackModalOpenAtom } from "~/atoms/feedback";
import { switchingWorkspaceAtom } from "~/atoms/switching-workspace";
import { ErrorContent } from "~/components/errors";

import FeedbackModal from "~/components/feedback/feedback-modal";
import {
  CommandPaletteButton,
  CommandPaletteRoot,
} from "~/components/layout/command-palette";
import { InstallPwaPromptModal } from "~/components/layout/install-pwa-prompt-modal";
import AppSidebar from "~/components/layout/sidebar/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/layout/sidebar/sidebar";
import { SkipLinks } from "~/components/layout/skip-links";
import { useCrisp } from "~/components/marketing/crisp";
import { ShelfMobileLogo } from "~/components/marketing/logos";
import { SequentialIdMigrationModal } from "~/components/sequential-id-migration-modal";
import { Spinner } from "~/components/shared/spinner";
import { Toaster } from "~/components/shared/toast";
import { MissingPaymentMethodBanner } from "~/components/subscription/missing-payment-method-banner";
import { NoSubscription } from "~/components/subscription/no-subscription";
import { UnpaidInvoiceBanner } from "~/components/subscription/unpaid-invoice-banner";
import { config } from "~/config/shelf.config";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import {
  getSelectedOrganization,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import { getUnreadCountForUser } from "~/modules/update/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import styles from "~/styles/layout/index.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  installPwaPromptCookie,
  expireHostOnlyUserPrefsCookie,
  initializePerPageCookieOnLayout,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import { isLikeShelfError, makeShelfError, ShelfError } from "~/utils/error";
import { isRouteError } from "~/utils/http";
import { payload, error } from "~/utils/http.server";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";

import {
  disabledTeamOrg,
  getCustomerActiveSubscription,
  getStripeCustomer,
  stripe,
  validateSubscriptionIsActive,
} from "~/utils/stripe.server";
import { canUseAudits, canUseBookings } from "~/utils/subscription.server";
import { tw } from "~/utils/tw";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export type LayoutLoaderResponse = typeof loader;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // Run user fetch and cookie parsing in parallel — these are independent
    // and safe to run before the onboarding guard.
    // NOTE: getSelectedOrganization is intentionally NOT included here.
    // It can throw when a user has no org membership, and the onboarding
    // guard (user.onboarded check) must run first to redirect non-onboarded
    // users before org resolution is attempted.
    const [user, userPrefsCookie, pwaPromptCookie] = await Promise.all([
      getUserByID(userId, {
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          displayName: true,
          profilePicture: true,
          onboarded: true,
          customerId: true,
          skipSubscriptionCheck: true,
          sso: true,
          tierId: true,
          hasUnpaidInvoice: true,
          warnForNoPaymentMethod: true,
          roles: { select: { id: true, name: true } },
          userOrganizations: {
            where: {
              userId: authSession.userId,
            },
            select: {
              id: true,
              roles: true,
              organization: { select: { id: true } },
            },
          },
        } satisfies Prisma.UserSelect,
      }),
      initializePerPageCookieOnLayout(request),
      installPwaPromptCookie
        .parse(request.headers.get("Cookie"))
        .then((c) => (c ?? {}) as { hidden?: boolean }),
    ]);

    let subscription = null;

    if (user.customerId && stripe) {
      const customer = (await getStripeCustomer(
        user.customerId
      )) as CustomerWithSubscriptions;
      subscription = getCustomerActiveSubscription({ customer });
      await validateSubscriptionIsActive({ user, subscription });
    }

    if (!user.onboarded) {
      return redirect("onboarding");
    }

    // Org resolution runs after the onboarding guard — safe now since
    // we know the user is onboarded and should have org membership.
    const {
      organizationId,
      organizations,
      currentOrganization,
      cookieRefreshNeeded,
      noVisibleOrganizations,
    } = await getSelectedOrganization({
      userId: authSession.userId,
      request,
    });

    // SSO user with no team orgs — redirect to a friendly pending page
    if (noVisibleOrganizations) {
      return redirect("/sso-pending-assignment");
    }

    const isAdmin = user?.roles.some((role) => role.name === Roles["ADMIN"]);

    // Get current user's organization role for updates filtering
    const currentOrganizationUserRoles = user?.userOrganizations.find(
      (userOrg) => userOrg.organization.id === organizationId
    )?.roles;

    // Check if current user has OWNER or ADMIN role in the organization
    const isOwner = currentOrganizationUserRoles?.includes("OWNER");
    const isOrgAdmin = currentOrganizationUserRoles?.includes("ADMIN");

    // Check if sequential ID migration is needed
    const needsSequentialIdMigration =
      (isOwner || isOrgAdmin) && !currentOrganization.hasSequentialIdsMigrated;

    if (!organizations.length || !currentOrganization) {
      throw new ShelfError({
        cause: null,
        title: "No organization",
        message:
          "You are not part of any organization. Please contact support.",
        status: 403,
        label: "Organization",
      });
    }

    // Run booking settings, working hours, and unread count in parallel —
    // all only depend on organizationId/userId which are available now.
    const [bookingSettings, workingHours, unreadUpdatesCount] =
      await Promise.all([
        getBookingSettingsForOrganization(currentOrganization.id),
        getWorkingHoursForOrganization(currentOrganization.id),
        currentOrganizationUserRoles?.[0]
          ? getUnreadCountForUser({
              userId: authSession.userId,
              userRole: currentOrganizationUserRoles[0],
            })
          : Promise.resolve(0),
      ]);

    return data(
      payload({
        user,
        organizations,
        currentOrganizationId: organizationId,
        bookingSettings,
        workingHours,
        currentOrganization,
        currentOrganizationUserRoles,
        subscription,
        enablePremium: config.enablePremiumFeatures,
        hideNoticeCard: userPrefsCookie.hideNoticeCard,
        minimizedSidebar: userPrefsCookie.minimizedSidebar,
        scannerCameraId: userPrefsCookie.scannerCameraId as string | undefined,
        hideInstallPwaPrompt: pwaPromptCookie.hidden,
        isAdmin,
        canUseBookings: canUseBookings(currentOrganization),
        canUseAudits: canUseAudits(currentOrganization),
        unreadUpdatesCount,
        hasUnpaidInvoice: user.hasUnpaidInvoice,
        warnForNoPaymentMethod: user.warnForNoPaymentMethod,
        needsSequentialIdMigration,
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
        headers: [
          setCookie(await userPrefs.serialize(userPrefsCookie)),
          expireHostOnlyUserPrefsCookie(),
          ...(cookieRefreshNeeded
            ? [setCookie(await setSelectedOrganizationIdCookie(organizationId))]
            : []),
        ],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId: authSession.userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ error }) => {
  if (!error) {
    return [{ title: "" }];
  }

  let title = "Something went wrong";

  if (isRouteError(error)) {
    title = error.data.error?.title ?? "";
  } else if (isLikeShelfError(error)) {
    title = error?.title ?? "";
  } else if (error instanceof Error) {
    title = error.name;
  }

  return [
    /** This will make sure that if we have an error its visible in the title of the browser tab */
    { title: appendToMetaTitle(title) },
  ];
};

export default function App() {
  useCrisp();
  const {
    disabledTeamOrg,
    hasUnpaidInvoice,
    warnForNoPaymentMethod,
    minimizedSidebar,
    needsSequentialIdMigration,
    currentOrganizationId,
  } = useLoaderData<typeof loader>();
  const workspaceSwitching = useAtomValue(switchingWorkspaceAtom);
  const [feedbackModalOpen, setFeedbackModalOpen] = useAtom(
    feedbackModalOpenAtom
  );

  const renderInstallPwaPromptOnMobile = () =>
    // returns InstallPwaPromptModal if the device width is lesser than 640px and the app is being accessed from browser not PWA
    window.matchMedia("(max-width: 640px)").matches &&
    !window.matchMedia("(display-mode: standalone)").matches ? (
      <InstallPwaPromptModal />
    ) : null;

  return (
    <CommandPaletteRoot>
      <SidebarProvider defaultOpen={!minimizedSidebar}>
        <SkipLinks />
        <AtomsResetHandler />
        <AppSidebar id="navigation" />
        <SidebarInset id="main-content" tabIndex={-1}>
          {warnForNoPaymentMethod ? <MissingPaymentMethodBanner /> : null}
          {hasUnpaidInvoice ? <UnpaidInvoiceBanner /> : null}
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
                  <CommandPaletteButton variant="icon" />
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

          {/* Sequential ID Migration Modal */}
          {needsSequentialIdMigration ? (
            <SequentialIdMigrationModal
              organizationId={currentOrganizationId}
            />
          ) : null}

          <FeedbackModal
            open={feedbackModalOpen}
            onClose={() => setFeedbackModalOpen(false)}
          />
        </SidebarInset>
      </SidebarProvider>
    </CommandPaletteRoot>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
