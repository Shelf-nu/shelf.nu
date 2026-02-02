import { SERVER_URL } from "~/utils/env";

interface Props {
  user: {
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
}: Props) => {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return `A Stripe invoice event requires attention.

Event: ${eventType}
User: ${name || "Unknown"} (${user.email})
Invoice: https://dashboard.stripe.com/invoices/${invoiceId}
Dashboard: ${SERVER_URL}/admin-dashboard/users

Please review the user's subscription status in the Stripe dashboard.

— Shelf System
`;
};
