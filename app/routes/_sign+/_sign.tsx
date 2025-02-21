import { Outlet } from "@remix-run/react";
import { useCrisp } from "~/components/marketing/crisp";

// @TODO - this needs to be cleaned up. Not sure what we want to do here
// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   const authSession = await requireAuthSession(request);
//   @TODO - we need to look into doing a select as we dont want to expose all data always
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
    <div className="flex h-screen flex-col items-center justify-center bg-[url('/static/images/bg-overlay1.png')] p-4 md:p-14">
      <div className="size-full border bg-gray-25">
        <Outlet />
      </div>
    </div>
  );
}
