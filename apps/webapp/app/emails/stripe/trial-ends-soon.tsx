import type Stripe from "stripe";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
interface Props {
  user: { firstName?: string | null; lastName?: string | null; email: string };
  subscription: Stripe.Subscription;
}

export const trialEndsSoonText = ({ user, subscription }: Props) => `Howdy ${
  user.firstName ? user.firstName : ""
} ${user.lastName ? user.lastName : ""},

You are reaching the end of your trial period with Shelf, which concludes on ${new Date(
  (subscription.trial_end as number) * 1000 // We force this as we check it before even calling the send email function
).toLocaleDateString()}. It's been a pleasure having you explore what Shelf has to offer. To maintain uninterrupted access to our premium features, we invite you to transition to one of our paid plans. You can make this upgrade by visiting your subscription settings: ${SERVER_URL}/account-details/subscription .

Should you have any inquiries or require further assistance, our support team is at your disposal. You can reach us via email at ${SUPPORT_EMAIL}.

Thank you for considering Shelf for your needs. We look forward to continuing to support your journey.

Warm regards,
The Shelf Team
`;
