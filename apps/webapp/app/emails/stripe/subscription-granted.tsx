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
  /**
   * The plan is a Team plan and the customer owns no Team workspace yet: the
   * call to action creates one instead of opening the app.
   */
  needsTeamWorkspace?: boolean;
}

/** The email's call to action: create a Team workspace, or open the app. */
function callToAction(needsTeamWorkspace?: boolean) {
  return needsTeamWorkspace
    ? {
        label: "Create your team workspace",
        href: `${SERVER_URL}/account-details/workspace/new`,
      }
    : { label: "Go to your workspace", href: `${SERVER_URL}` };
}

interface SendSubscriptionGrantedEmailProps
  extends SubscriptionGrantedEmailProps {
  email: string;
}

export const sendSubscriptionGrantedEmail = async ({
  customerName,
  subscriptionName,
  needsTeamWorkspace,
  email,
}: SendSubscriptionGrantedEmailProps) => {
  try {
    const subject = "Your Shelf subscription is now active";
    const html = await subscriptionGrantedHtml({
      customerName,
      subscriptionName,
      needsTeamWorkspace,
    });
    const text = subscriptionGrantedText({
      customerName,
      subscriptionName,
      needsTeamWorkspace,
    });

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
  needsTeamWorkspace,
}: SubscriptionGrantedEmailProps) => {
  const greeting = customerName ? `Hey ${customerName}` : "Hey there";
  const cta = callToAction(needsTeamWorkspace);
  const getStarted = needsTeamWorkspace
    ? `Your plan is used in a team workspace. ${cta.label}: ${cta.href}`
    : `Get started: ${cta.href}`;

  return `${greeting},

Great news! Your ${subscriptionName} subscription is now active.

You now have access to all the features included in your plan:

- Unlimited custom fields to tailor Shelf to your needs
- Team workspaces for seamless collaboration
- Advanced asset management features
- Priority support

${getStarted}

You can manage your subscription anytime from your subscription settings:
${SERVER_URL}/account-details/subscription

If you have any questions, feel free to reach out to us at ${SUPPORT_EMAIL}. We're happy to help!

The Shelf Team
`;
};

function SubscriptionGrantedEmailTemplate({
  customerName,
  subscriptionName,
  needsTeamWorkspace,
}: SubscriptionGrantedEmailProps) {
  const { emailPrimaryColor } = config;
  const cta = callToAction(needsTeamWorkspace);

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

          {needsTeamWorkspace ? (
            <Text style={{ ...styles.p }}>
              Your plan is used in a team workspace. Create yours to get
              started.
            </Text>
          ) : null}

          <Button
            href={cta.href}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "200px",
              marginBottom: "24px",
            }}
          >
            {cta.label}
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
  needsTeamWorkspace,
}: SubscriptionGrantedEmailProps) =>
  render(
    <SubscriptionGrantedEmailTemplate
      customerName={customerName}
      subscriptionName={subscriptionName}
      needsTeamWorkspace={needsTeamWorkspace}
    />
  );
