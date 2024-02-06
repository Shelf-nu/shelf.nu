import type Stripe from "stripe";
import { SERVER_URL } from "~/utils";
interface Props {
  user: { firstName?: string | null; lastName?: string | null; email: string };
  subscription: Stripe.Subscription;
}

export const trialEndsSoonText = ({ user, subscription }: Props) => `Howdy ${
  user.firstName ? user.firstName : ""
} ${user.lastName ? user.lastName : ""},

Your trial is ending on ${new Date(
  (subscription.trial_end as number) * 1000 // We force this as we check it before even calling the send email function
).toLocaleDateString()}. We hope you've enjoyed using Shelf so far. 
If you want to continue using the premium features, please upgrade to a paid plan to continue using the service. ${SERVER_URL}/settings/subscription

Once you’re done setting up your account, you'll be able to access the workspace and start exploring features like Asset Explorer, Location Tracking, Collaboration, Custom fields and more.

If you have any questions or need assistance, please don't hesitate to contact our support at support@shelf.nu

Thanks,
The Shelf Team
`;
