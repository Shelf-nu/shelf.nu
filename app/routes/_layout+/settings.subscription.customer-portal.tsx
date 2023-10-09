import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { createBillingPortalSession } from "~/utils/stripe.server";

export async function action({ request }: ActionFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const user = await db.user.findUnique({
    where: { id: authSession.userId },
    select: { customerId: true },
  });

  if (!user?.customerId) throw new Error("No customer ID found");

  const { url } = await createBillingPortalSession({
    customerId: user.customerId,
  });

  return redirect(url);
}
