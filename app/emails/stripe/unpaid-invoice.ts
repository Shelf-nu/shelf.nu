import { SERVER_URL } from "~/utils/env";

interface AdminEmailProps {
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  };
  eventType: string;
  invoiceId: string;
}

export const unpaidInvoiceAdminText = ({
  user,
  eventType,
  invoiceId,
}: AdminEmailProps) => {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return `A Stripe invoice event requires attention.

Event: ${eventType}
User: ${name || "Unknown"} (${user.email})
Invoice: https://dashboard.stripe.com/invoices/${invoiceId}
User Dashboard: ${SERVER_URL}/admin-dashboard/${user.id}

Please review the user's subscription status in the Stripe dashboard.

— Shelf System
`;
};

interface UserEmailProps {
  customerEmail: string;
  customerName?: string | null;
  subscriptionName: string;
  amountDue: string;
  dueDate?: string | null;
}

export const unpaidInvoiceUserText = ({
  customerEmail,
  customerName,
  subscriptionName,
  amountDue,
  dueDate,
}: UserEmailProps) => {
  const greeting = customerName ? `Hi ${customerName}` : "Hi there";

  return `${greeting},

We wanted to let you know that we weren't able to process your recent payment for your Shelf subscription.

Subscription: ${subscriptionName}
Amount due: ${amountDue}${dueDate ? `\nDue date: ${dueDate}` : ""}

Don't worry — these things happen! To keep your subscription active and avoid any interruption to your service, please update your payment information when you get a chance.

You can review your subscription and update your payment method here:
${SERVER_URL}/account-details/subscription

If you have any questions or need help, just reply to this email — we're happy to assist.

Thanks for being a Shelf customer!

Warm regards,
The Shelf Team

—
${customerEmail}
`;
};
