import {
  Button,
  Container,
  Head,
  Html,
  Link,
  render,
  Text,
} from "@react-email/components";
import { BARCODE_ADDON } from "~/config/addon-copy";
import { config } from "~/config/shelf.config";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { LogoForEmail } from "../logo";
import { sendEmail } from "../mail.server";
import { styles } from "../styles";

interface BarcodeTrialWelcomeProps {
  firstName?: string | null;
  email: string;
  hasPaymentMethod?: boolean;
}

export const sendBarcodeTrialWelcomeEmail = async ({
  firstName,
  email,
  hasPaymentMethod,
}: BarcodeTrialWelcomeProps) => {
  try {
    const subject = "Your 7-day Barcodes trial is now active!";
    const html = await barcodeTrialWelcomeEmailHtml({
      firstName,
      hasPaymentMethod,
    });
    const text = barcodeTrialWelcomeEmailText({ firstName, hasPaymentMethod });

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
          "Something went wrong while sending the barcode trial welcome email",
        additionalData: { email },
        label: "User",
      })
    );
  }
};

export const barcodeTrialWelcomeEmailText = ({
  firstName,
  hasPaymentMethod,
}: {
  firstName?: string | null;
  hasPaymentMethod?: boolean;
}) => `Hey${firstName ? ` ${firstName}` : ""},

Great news - your 7-day Barcodes trial is now active! You have full access to all barcode features starting today.

Here's what you can do with Barcodes:

${BARCODE_ADDON.features.map((f) => `- ${f}`).join("\n")}

Get started now: ${SERVER_URL}/settings/general
${
  hasPaymentMethod
    ? `\nImportant: Because you already have a payment method on file, your subscription will automatically continue after the 7-day trial ends. If you decide Barcodes isn't for you, you can cancel anytime before the trial ends from your subscription settings to avoid being charged.\n\nManage your subscription: ${SERVER_URL}/account-details/subscription`
    : ""
}

If you have any questions, feel free to reach out to us at ${SUPPORT_EMAIL}. We're happy to help!

Happy labeling,
The Shelf Team
`;

function BarcodeTrialWelcomeEmailTemplate({
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
        <title>Your 7-day Barcodes trial is now active!</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Hey{firstName ? ` ${firstName}` : ""},
          </Text>

          <Text style={{ ...styles.p }}>
            Great news - your <strong>7-day Barcodes trial</strong> is now
            active! You have full access to all barcode features starting today.
          </Text>

          <Text style={{ ...styles.h2 }}>
            Here's what you can do with Barcodes:
          </Text>

          <ul style={{ ...styles.li, paddingLeft: "20px" }}>
            {BARCODE_ADDON.features.map((feature) => (
              <li key={feature} style={{ marginBottom: "8px" }}>
                {feature}
              </li>
            ))}
          </ul>

          <Button
            href={`${SERVER_URL}/settings/general`}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "200px",
              marginBottom: "24px",
            }}
          >
            Explore Barcodes
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
              after the 7-day trial ends. If you decide Barcodes isn't for you,
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
            Happy labeling, <br />
            The Shelf Team
          </Text>
        </div>
      </Container>
    </Html>
  );
}

export const barcodeTrialWelcomeEmailHtml = ({
  firstName,
  hasPaymentMethod,
}: {
  firstName?: string | null;
  hasPaymentMethod?: boolean;
}) =>
  render(
    <BarcodeTrialWelcomeEmailTemplate
      firstName={firstName}
      hasPaymentMethod={hasPaymentMethod}
    />
  );
