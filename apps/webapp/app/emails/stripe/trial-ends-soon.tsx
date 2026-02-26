import {
  Button,
  Container,
  Head,
  Html,
  render,
  Text,
} from "@react-email/components";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { LogoForEmail } from "../logo";
import { sendEmail } from "../mail.server";
import { styles } from "../styles";

interface TrialEndsSoonProps {
  firstName?: string | null;
  email: string;
  trialEndDate: Date;
}

export const sendTrialEndsSoonEmail = async ({
  firstName,
  email,
  trialEndDate,
}: TrialEndsSoonProps) => {
  try {
    const subject = "Your Shelf free trial is ending soon";
    const html = await trialEndsSoonEmailHtml({ firstName, trialEndDate });
    const text = trialEndsSoonEmailText({ firstName, trialEndDate });

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
        message: "Something went wrong while sending the trial ends soon email",
        additionalData: { email },
        label: "User",
      })
    );
  }
};

export const trialEndsSoonEmailText = ({
  firstName,
  trialEndDate,
}: {
  firstName?: string | null;
  trialEndDate: Date;
}) => {
  const dateStr = trialEndDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return `Hey${firstName ? ` ${firstName}` : ""},

Your Shelf free trial ends on ${dateStr}. It's been a pleasure having you explore what Shelf has to offer.

To maintain uninterrupted access to our premium features, we invite you to transition to one of our paid plans. You can make this upgrade by visiting your subscription settings: ${SERVER_URL}/account-details/subscription

If you have any questions, feel free to reach out to us at ${SUPPORT_EMAIL}. We're happy to help!

The Shelf Team
`;
};

function TrialEndsSoonEmailTemplate({
  firstName,
  trialEndDate,
}: {
  firstName?: string | null;
  trialEndDate: Date;
}) {
  const dateStr = trialEndDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Html>
      <Head>
        <title>Your Shelf free trial is ending soon</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Hey{firstName ? ` ${firstName}` : ""},
          </Text>

          <Text style={{ ...styles.p }}>
            Your <strong>Shelf free trial</strong> ends on{" "}
            <strong>{dateStr}</strong>. It's been a pleasure having you explore
            what Shelf has to offer.
          </Text>

          <Text style={{ ...styles.p }}>
            To maintain uninterrupted access to our premium features, we invite
            you to upgrade to one of our paid plans:
          </Text>

          <Button
            href={`${SERVER_URL}/account-details/subscription`}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "200px",
              marginBottom: "24px",
            }}
          >
            View plans
          </Button>

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

export const trialEndsSoonEmailHtml = ({
  firstName,
  trialEndDate,
}: {
  firstName?: string | null;
  trialEndDate: Date;
}) =>
  render(
    <TrialEndsSoonEmailTemplate
      firstName={firstName}
      trialEndDate={trialEndDate}
    />
  );
