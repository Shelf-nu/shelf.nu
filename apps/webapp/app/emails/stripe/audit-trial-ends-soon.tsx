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

interface AuditTrialEndsSoonProps {
  firstName?: string | null;
  email: string;
  hasPaymentMethod: boolean;
  trialEndDate: Date;
}

export const sendAuditTrialEndsSoonEmail = async ({
  firstName,
  email,
  hasPaymentMethod,
  trialEndDate,
}: AuditTrialEndsSoonProps) => {
  try {
    const subject = hasPaymentMethod
      ? "Your Audits trial ends in 3 days — auto-charge reminder"
      : "Your Audits trial is ending soon";
    const html = await auditTrialEndsSoonEmailHtml({
      firstName,
      hasPaymentMethod,
      trialEndDate,
    });
    const text = auditTrialEndsSoonEmailText({
      firstName,
      hasPaymentMethod,
      trialEndDate,
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
          "Something went wrong while sending the audit trial ends soon email",
        additionalData: { email },
        label: "User",
      })
    );
  }
};

export const auditTrialEndsSoonEmailText = ({
  firstName,
  hasPaymentMethod,
  trialEndDate,
}: {
  firstName?: string | null;
  hasPaymentMethod: boolean;
  trialEndDate: Date;
}) => {
  const dateStr = trialEndDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  if (hasPaymentMethod) {
    return `Hey${firstName ? ` ${firstName}` : ""},

ACTION REQUIRED: You will be automatically charged when your trial ends.

Your 7-day Audits trial ends on ${dateStr}. Because you have a payment method on file, you will be automatically charged at the regular subscription rate when the trial ends. To avoid being charged, cancel from your subscription settings before the trial ends: ${SERVER_URL}/account-details/subscription

If you'd like to keep using Audits, no action is needed - everything will transition seamlessly.

If you have any questions, feel free to reach out to us at ${SUPPORT_EMAIL}. We're happy to help!

The Shelf Team
`;
  }

  return `Hey${firstName ? ` ${firstName}` : ""},

Your 7-day Audits trial ends on ${dateStr}. Since you don't have a payment method on file, your Audits access will be paused when the trial ends.

To keep using Audits without interruption, add a payment method before the trial expires: ${SERVER_URL}/account-details/subscription

Don't worry - your audit data won't be deleted. Once you subscribe, everything will be right where you left it.

If you have any questions, feel free to reach out to us at ${SUPPORT_EMAIL}. We're happy to help!

The Shelf Team
`;
};

function AuditTrialEndsSoonEmailTemplate({
  firstName,
  hasPaymentMethod,
  trialEndDate,
}: {
  firstName?: string | null;
  hasPaymentMethod: boolean;
  trialEndDate: Date;
}) {
  const { emailPrimaryColor } = config;

  const dateStr = trialEndDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Html>
      <Head>
        <title>Your Audits trial is ending soon</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Hey{firstName ? ` ${firstName}` : ""},
          </Text>

          {hasPaymentMethod ? (
            <>
              <Text
                style={{
                  ...styles.p,
                  backgroundColor: "#FFF8E1",
                  border: "1px solid #FFE082",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <strong>
                  Action required if you don't want to be charged.
                </strong>{" "}
                Your 7-day Audits trial ends on <strong>{dateStr}</strong>.
                Because you have a payment method on file, you will be
                automatically charged at the regular subscription rate when the
                trial ends. To avoid being charged, cancel from your{" "}
                <Link
                  href={`${SERVER_URL}/account-details/subscription`}
                  style={{ color: emailPrimaryColor }}
                >
                  subscription settings
                </Link>{" "}
                before the trial ends.
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
                Manage subscription
              </Button>

              <Text style={{ ...styles.p }}>
                If you'd like to keep using Audits, no action is needed —
                everything will transition seamlessly.
              </Text>
            </>
          ) : (
            <>
              <Text style={{ ...styles.p }}>
                Your <strong>7-day Audits trial</strong> ends on{" "}
                <strong>{dateStr}</strong>.
              </Text>

              <Text style={{ ...styles.p }}>
                Since you don't have a payment method on file, your Audits
                access will be <strong>paused</strong> when the trial ends.
              </Text>

              <Text style={{ ...styles.p }}>
                To keep using Audits without interruption, add a payment method
                before the trial expires:
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
                Add payment method
              </Button>

              <Text style={{ ...styles.p }}>
                Don't worry — your audit data won't be deleted. Once you
                subscribe, everything will be right where you left it.
              </Text>
            </>
          )}

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

export const auditTrialEndsSoonEmailHtml = ({
  firstName,
  hasPaymentMethod,
  trialEndDate,
}: {
  firstName?: string | null;
  hasPaymentMethod: boolean;
  trialEndDate: Date;
}) =>
  render(
    <AuditTrialEndsSoonEmailTemplate
      firstName={firstName}
      hasPaymentMethod={hasPaymentMethod}
      trialEndDate={trialEndDate}
    />
  );
