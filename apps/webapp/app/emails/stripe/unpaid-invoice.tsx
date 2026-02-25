import {
  Button,
  Container,
  Head,
  Html,
  Link,
  render,
  Text,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { LogoForEmail } from "../logo";
import { sendEmail } from "../mail.server";
import { styles } from "../styles";

// --- Admin email (text-only, internal notification) ---

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

// --- User email (HTML + text) ---

interface UserEmailProps {
  customerEmail: string;
  customerName?: string | null;
  subscriptionName: string;
  amountDue: string;
  dueDate?: string | null;
}

interface SendUnpaidInvoiceUserEmailProps extends UserEmailProps {
  subject: string;
}

export const sendUnpaidInvoiceUserEmail = async ({
  customerEmail,
  customerName,
  subscriptionName,
  amountDue,
  dueDate,
  subject,
}: SendUnpaidInvoiceUserEmailProps) => {
  try {
    const html = await unpaidInvoiceUserHtml({
      customerEmail,
      customerName,
      subscriptionName,
      amountDue,
      dueDate,
    });
    const text = unpaidInvoiceUserText({
      customerEmail,
      customerName,
      subscriptionName,
      amountDue,
      dueDate,
    });

    void sendEmail({
      to: customerEmail,
      subject,
      html,
      text,
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message:
          "Something went wrong while sending the unpaid invoice user email",
        additionalData: { customerEmail },
        label: "User",
      })
    );
  }
};

export const unpaidInvoiceUserText = ({
  customerName,
  subscriptionName,
  amountDue,
  dueDate,
}: UserEmailProps) => {
  const greeting = customerName ? `Hey ${customerName}` : "Hey there";

  return `${greeting},

We wanted to let you know that we weren't able to process your recent payment for your Shelf subscription.

Subscription: ${subscriptionName}
Amount due: ${amountDue}${dueDate ? `\nDue date: ${dueDate}` : ""}

Don't worry - these things happen! To keep your subscription active and avoid any interruption to your service, please update your payment information.

Update your payment method: ${SERVER_URL}/account-details/subscription

If you have any questions, feel free to reach out to us at ${SUPPORT_EMAIL}. We're happy to help!

The Shelf Team
`;
};

function UnpaidInvoiceUserEmailTemplate({
  customerName,
  subscriptionName,
  amountDue,
  dueDate,
}: UserEmailProps) {
  const { emailPrimaryColor } = config;

  return (
    <Html>
      <Head>
        <title>Action needed: Payment issue with your Shelf subscription</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Hey{customerName ? ` ${customerName}` : " there"},
          </Text>

          <Text style={{ ...styles.p }}>
            We wanted to let you know that we weren't able to process your
            recent payment for your Shelf subscription.
          </Text>

          <Text
            style={{
              ...styles.p,
              backgroundColor: "#FFF8E1",
              border: "1px solid #FFE082",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <strong>Subscription:</strong> {subscriptionName}
            <br />
            <strong>Amount due:</strong> {amountDue}
            {dueDate ? (
              <>
                <br />
                <strong>Due date:</strong> {dueDate}
              </>
            ) : null}
          </Text>

          <Text style={{ ...styles.p }}>
            Don't worry - these things happen! To keep your subscription active
            and avoid any interruption to your service, please update your
            payment information.
          </Text>

          <Button
            href={`${SERVER_URL}/account-details/subscription`}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "250px",
              marginBottom: "24px",
            }}
          >
            Update payment method
          </Button>

          <Text style={{ ...styles.p }}>
            If you need help, you can also manage your subscription from your{" "}
            <Link
              href={`${SERVER_URL}/account-details/subscription`}
              style={{ color: emailPrimaryColor }}
            >
              subscription settings
            </Link>
            .
          </Text>

          <Text style={{ marginTop: "24px", ...styles.p }}>
            If you have any questions, feel free to reach out to us at{" "}
            {SUPPORT_EMAIL}. We're happy to help!
          </Text>

          <Text style={{ marginTop: "24px", ...styles.p }}>The Shelf Team</Text>
        </div>
      </Container>
    </Html>
  );
}

export const unpaidInvoiceUserHtml = ({
  customerEmail,
  customerName,
  subscriptionName,
  amountDue,
  dueDate,
}: UserEmailProps) =>
  render(
    <UnpaidInvoiceUserEmailTemplate
      customerEmail={customerEmail}
      customerName={customerName}
      subscriptionName={subscriptionName}
      amountDue={amountDue}
      dueDate={dueDate}
    />
  );
