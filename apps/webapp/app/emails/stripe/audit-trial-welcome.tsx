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

interface AuditTrialWelcomeProps {
  firstName?: string | null;
  email: string;
  hasPaymentMethod?: boolean;
}

export const sendAuditTrialWelcomeEmail = async ({
  firstName,
  email,
  hasPaymentMethod,
}: AuditTrialWelcomeProps) => {
  try {
    const subject = "Your 7-day Audits trial is now active!";
    const html = await auditTrialWelcomeEmailHtml({
      firstName,
      hasPaymentMethod,
    });
    const text = auditTrialWelcomeEmailText({ firstName, hasPaymentMethod });

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
          "Something went wrong while sending the audit trial welcome email",
        additionalData: { email },
        label: "User",
      })
    );
  }
};

export const auditTrialWelcomeEmailText = ({
  firstName,
  hasPaymentMethod,
}: {
  firstName?: string | null;
  hasPaymentMethod?: boolean;
}) => `Hey${firstName ? ` ${firstName}` : ""},

Great news - your 7-day Audits trial is now active! You have full access to all audit features starting today.

Here's what you can do with Audits:

- Create audits and assign auditors to verify your assets
- Set due dates and track progress in real-time
- Use QR code scanning for quick asset verification
- Generate detailed audit reports

Get started now: ${SERVER_URL}/audits
${
  hasPaymentMethod
    ? `\nImportant: Because you already have a payment method on file, your subscription will automatically continue after the 7-day trial ends. If you decide Audits isn't for you, you can cancel anytime before the trial ends from your subscription settings to avoid being charged.\n\nManage your subscription: ${SERVER_URL}/account-details/subscription`
    : ""
}

If you have any questions, feel free to reach out to us at ${SUPPORT_EMAIL}. We're happy to help!

Happy auditing,
The Shelf Team
`;

function AuditTrialWelcomeEmailTemplate({
  firstName,
  hasPaymentMethod,
}: {
  firstName?: string | null;
  hasPaymentMethod?: boolean;
}) {
  const { emailPrimaryColor } = config;

  return (
    <Html>
      <Head>
        <title>Your 7-day Audits trial is now active!</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Hey{firstName ? ` ${firstName}` : ""},
          </Text>

          <Text style={{ ...styles.p }}>
            Great news - your <strong>7-day Audits trial</strong> is now active!
            You have full access to all audit features starting today.
          </Text>

          <Text style={{ ...styles.h2 }}>
            Here's what you can do with Audits:
          </Text>

          <ul style={{ ...styles.li, paddingLeft: "20px" }}>
            <li style={{ marginBottom: "8px" }}>
              Create audits and assign auditors to verify your assets
            </li>
            <li style={{ marginBottom: "8px" }}>
              Set due dates and track progress in real-time
            </li>
            <li style={{ marginBottom: "8px" }}>
              Use QR code scanning for quick asset verification
            </li>
            <li style={{ marginBottom: "8px" }}>
              Generate detailed audit reports
            </li>
          </ul>

          <Button
            href={`${SERVER_URL}/audits`}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "200px",
              marginBottom: "24px",
            }}
          >
            Start your first audit
          </Button>

          {hasPaymentMethod ? (
            <Text
              style={{
                ...styles.p,
                backgroundColor: "#FFF8E1",
                border: "1px solid #FFE082",
                borderRadius: "8px",
                padding: "16px",
              }}
            >
              <strong>Important:</strong> Because you already have a payment
              method on file, your subscription will automatically continue
              after the 7-day trial ends. If you decide Audits isn't for you,
              you can cancel anytime before the trial ends from your{" "}
              <Link
                href={`${SERVER_URL}/account-details/subscription`}
                style={{ color: emailPrimaryColor }}
              >
                subscription settings
              </Link>{" "}
              to avoid being charged.
            </Text>
          ) : null}

          <Text style={{ marginTop: "24px", ...styles.p }}>
            If you have any questions, feel free to reach out to us at{" "}
            {SUPPORT_EMAIL}. We're happy to help!
          </Text>

          <Text style={{ marginTop: "24px", ...styles.p }}>
            Happy auditing, <br />
            The Shelf Team
          </Text>
        </div>
      </Container>
    </Html>
  );
}

export const auditTrialWelcomeEmailHtml = ({
  firstName,
  hasPaymentMethod,
}: {
  firstName?: string | null;
  hasPaymentMethod?: boolean;
}) =>
  render(
    <AuditTrialWelcomeEmailTemplate
      firstName={firstName}
      hasPaymentMethod={hasPaymentMethod}
    />
  );
