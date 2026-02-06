import { SERVER_URL } from "~/utils/env";

interface SubscriptionGrantedEmailProps {
  customerName?: string | null;
  subscriptionName: string;
}

export const subscriptionGrantedText = ({
  customerName,
  subscriptionName,
}: SubscriptionGrantedEmailProps) => {
  const greeting = customerName ? `Hi ${customerName}` : "Hi there";

  return `${greeting},

Great news! A subscription has been added to your Shelf account.

Subscription: ${subscriptionName}

You now have access to all the features included in your plan. You can review your subscription details and manage your account here:
${SERVER_URL}/account-details/subscription

If you have any questions or need help getting started, just reply to this email — we're happy to assist.

Thanks for being part of Shelf!

Warm regards,
The Shelf Team
`;
};
