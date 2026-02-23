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

interface SubscriptionGrantedEmailProps {
  customerName?: string | null;
  subscriptionName: string;
}

interface SendSubscriptionGrantedEmailProps
  extends SubscriptionGrantedEmailProps {
  email: string;
}

export const sendSubscriptionGrantedEmail = async ({
  customerName,
  subscriptionName,
  email,
}: SendSubscriptionGrantedEmailProps) => {
  try {
    const subject = "Your Shelf subscription is now active";
    const html = await subscriptionGrantedHtml({
      customerName,
      subscriptionName,
    });
    const text = subscriptionGrantedText({ customerName, subscriptionName });

    void sendEmail({
      to: email,
      subject,
      html,
      text,
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message:
          "Something went wrong while sending the subscription granted email",
        additionalData: { email },
        label: "User",
      })
    );
  }
};

export const subscriptionGrantedText = ({
  customerName,
  subscriptionName,
}: SubscriptionGrantedEmailProps) => {
  const greeting = customerName ? `Hey ${customerName}` : "Hey there";

  return `${greeting},

Great news! Your ${subscriptionName} subscription is now active.

You now have access to all the features included in your plan:

- Unlimited custom fields to tailor Shelf to your needs
- Team workspaces for seamless collaboration
- Advanced asset management features
- Priority support

Get started: ${SERVER_URL}

You can manage your subscription anytime from your subscription settings:
${SERVER_URL}/account-details/subscription

If you have any questions, feel free to reach out to us at ${SUPPORT_EMAIL}. We're happy to help!

The Shelf Team
`;
};

function SubscriptionGrantedEmailTemplate({
  customerName,
  subscriptionName,
}: SubscriptionGrantedEmailProps) {
  const { emailPrimaryColor } = config;

  return (
    <Html>
      <Head>
        <title>Your Shelf subscription is now active</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Hey{customerName ? ` ${customerName}` : " there"},
          </Text>

          <Text style={{ ...styles.p }}>
            Great news! Your <strong>{subscriptionName}</strong> subscription is
            now active. You have access to all the features included in your
            plan.
          </Text>

          <Text style={{ ...styles.h2 }}>
            Here's what's included in your plan:
          </Text>

          <ul style={{ ...styles.li, paddingLeft: "20px" }}>
            <li style={{ marginBottom: "8px" }}>
              Unlimited custom fields to tailor Shelf to your needs
            </li>
            <li style={{ marginBottom: "8px" }}>
              Team workspaces for seamless collaboration
            </li>
            <li style={{ marginBottom: "8px" }}>
              Advanced asset management features
            </li>
            <li style={{ marginBottom: "8px" }}>Priority support</li>
          </ul>

          <Button
            href={`${SERVER_URL}`}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "200px",
              marginBottom: "24px",
            }}
          >
            Go to your workspace
          </Button>

          <Text style={{ ...styles.p }}>
            You can manage your subscription anytime from your{" "}
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

export const subscriptionGrantedHtml = ({
  customerName,
  subscriptionName,
}: SubscriptionGrantedEmailProps) =>
  render(
    <SubscriptionGrantedEmailTemplate
      customerName={customerName}
      subscriptionName={subscriptionName}
    />
  );
