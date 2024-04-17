import type { LinksFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { useCrisp } from "~/components/marketing/crisp";
import styles from "~/styles/layout/index.css";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   const authSession = await requireAuthSession(request);
//   // @TODO - we need to look into doing a select as we dont want to expose all data always
//   const user = authSession
//     ? await db.user.findUnique({
//         where: { email: authSession.email.toLowerCase() },
//         include: {
//           roles: true,
//           organizations: {
//             select: {
//               id: true,
//               name: true,
//               type: true,
//               imageId: true,
//             },
//           },
//           userOrganizations: {
//             where: {
//               userId: authSession.userId,
//             },
//             select: {
//               organization: true,
//             },
//           },
//         },
//       })
//     : undefined;
//   let subscription = null;
//   if (user?.customerId && stripe) {
//     // Get the Stripe customer
//     const customer = (await getStripeCustomer(
//       user.customerId
//     )) as CustomerWithSubscriptions;
//     /** Find the active subscription for the Stripe customer */
//     subscription = getCustomerActiveSubscription({ customer });
//   }

//   const cookie = await initializePerPageCookieOnLayout(request);

//   if (!user?.onboarded) {
//     return redirect("onboarding");
//   }

//   /** There could be a case when you get removed from an organization while browsing it.
//    * In this case what we do is we set the current organization to the first one in the list
//    */
//   const { organizationId, organizations } = await requireOrganisationId(
//     authSession,
//     request
//   );

//   return json(
//     {
//       user,
//       organizations,
//       currentOrganizationId: organizationId,
//       subscription,
//       enablePremium: ENABLE_PREMIUM_FEATURES,
//       isAdmin: user?.roles.some((role) => role.name === Roles["ADMIN"]),
//     },
//     {
//       headers: [
//         setCookie(await userPrefs.serialize(cookie)),
//         setCookie(
//           await commitAuthSession(request, {
//             authSession,
//           })
//         ),
//       ],
//     }
//   );
// };

export default function App() {
  useCrisp();

  return (
    <div className="flex h-full min-h-screen flex-col ">
      <main className="relative flex size-full">
        <div className="flex size-full flex-col items-center justify-center md:p-20">
          <div className="size-full rounded-xl bg-white shadow-xl">
            <Outlet />
          </div>
        </div>
        <img
          src="/images/bg-overlay1.png"
          alt="bg-overlay"
          className="absolute right-0 top-0 -z-10 size-full object-cover"
        />
      </main>
    </div>
  );
}

export const ErrorBoundary = () => (
);
