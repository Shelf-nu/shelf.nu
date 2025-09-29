import type Stripe from "stripe";
import { SERVER_URL } from "~/utils/env";
interface Props {
  user: { firstName?: string | null; lastName?: string | null; email: string };
  subscription: Stripe.Subscription;
}

export const trialEndsSoonText = ({ user, subscription }: Props) => `Howdy ${
  user.firstName ? user.firstName : ""
} ${user.lastName ? user.lastName : ""},

Your Shelf trial ends on ${new Date(
  (subscription.trial_end as number) * 1000
).toLocaleDateString()}.

After that, your workspace freezes completely.

What stops working:
❌ You can't access your assets
❌ Your team gets locked out
❌ Bookings stop working

Your data is safe, but everything pauses until you upgrade.

→ Keep your workspace active: ${SERVER_URL}/account-details/subscription

Takes 60 seconds. Your setup stays intact.

Questions? Hit reply.

Best,
Carlos A. Virreira
Founder / CEO
Shelf Asset Management, Inc.

P.S. - Not ready? Reply and tell me why. Maybe I can help.
`;
