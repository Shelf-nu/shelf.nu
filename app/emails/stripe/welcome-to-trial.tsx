import {
  Html,
  Text,
  Link,
  Head,
  render,
  Container,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { LogoForEmail } from "../logo";
import { sendEmail } from "../mail.server";
import { styles } from "../styles";

export const sendTeamTrialWelcomeEmail = ({ email }: { email: string }) => {
  try {
    const subject = `Your Shelf Team Trial is ready`;
    const html = welcomeToTrialEmailHtml();
    const text = welcomeToTrialEmailText();

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
        message: "Something went wrong while sending the welcome email",
        additionalData: { email },
        label: "User",
      })
    );
  }
};

/**
 * THis is the text version of the onboarding email
 */
export const welcomeToTrialEmailText = () => `Hi there,

Carlos here. Your Team Trial is live.

Week 1: Get Assets In
→ Create team workspace: ${SERVER_URL}/account-details/workspace
→ Add 10-20 assets
→ Print QR codes (this is the magic)

Week 2: Add Your Team
→ Invite colleagues
→ Set up locations
→ Create your first booking

Week 3: Go Deep
→ Custom Fields: https://www.shelf.nu/knowledge-base/custom-field-types-in-shelf
→ Kits: https://www.shelf.nu/features/kits
→ Bookings: https://www.shelf.nu/knowledge-base/use-case-scenarios-explaing-our-bookings-feature

Need labels? → http://store.shelf.nu

Questions? Hit reply.

Best,
Carlos A. Virreira
Founder / CEO
Shelf Asset Management, Inc.

P.S. - Most teams see ROI in week 2.
`;

function WelcomeToTrialEmailTemplate() {
  const { emailPrimaryColor } = config;

  return (
    <Html>
      <Head>
        <title>Your Shelf Team Trial is ready</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ marginBottom: "12px", ...styles.p }}>Hi there,</Text>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Carlos here. Your Team Trial is live.
          </Text>

          <Text style={{ ...styles.p, fontWeight: 600 }}>
            Week 1: Get Assets In
          </Text>
          <ul style={{ ...styles.li }}>
            <li>
              Create team workspace:{" "}
              <Link
                href={`${SERVER_URL}/account-details/workspace`}
                style={{ color: emailPrimaryColor }}
              >
                {SERVER_URL}/account-details/workspace
              </Link>
            </li>
            <li>Add 10-20 assets</li>
            <li>Print QR codes (this is the magic)</li>
          </ul>

          <Text style={{ ...styles.p, fontWeight: 600 }}>
            Week 2: Add Your Team
          </Text>
          <ul style={{ ...styles.li }}>
            <li>Invite colleagues</li>
            <li>Set up locations</li>
            <li>Create your first booking</li>
          </ul>

          <Text style={{ ...styles.p, fontWeight: 600 }}>Week 3: Go Deep</Text>
          <ul style={{ ...styles.li }}>
            <li>
              <Link
                href="https://www.shelf.nu/knowledge-base/custom-field-types-in-shelf"
                style={{ color: emailPrimaryColor }}
              >
                Custom Fields
              </Link>
            </li>
            <li>
              <Link
                href="https://www.shelf.nu/features/kits"
                style={{ color: emailPrimaryColor }}
              >
                Kits
              </Link>
            </li>
            <li>
              <Link
                href="https://www.shelf.nu/knowledge-base/use-case-scenarios-explaing-our-bookings-feature"
                style={{ color: emailPrimaryColor }}
              >
                Bookings
              </Link>
            </li>
          </ul>

          <Text style={{ marginBottom: "16px", ...styles.p }}>
            Need labels?{" "}
            <Link
              href="http://store.shelf.nu"
              style={{ color: emailPrimaryColor }}
            >
              http://store.shelf.nu
            </Link>
          </Text>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Questions? Hit reply.
          </Text>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Best,
            <br />
            Carlos A. Virreira
            <br />
            Founder / CEO
            <br />
            Shelf Asset Management, Inc.
          </Text>
          <Text style={{ ...styles.p }}>
            P.S. - Most teams see ROI in week 2.
          </Text>
        </div>
      </Container>
    </Html>
  );
}

/*
 *The HTML content of an email will be accessed by a server file to send email,
  we cannot import a TSX component in a server file so we are exporting TSX converted to HTML string using render function by react-email.
 */
export const welcomeToTrialEmailHtml = () =>
  render(<WelcomeToTrialEmailTemplate />);
