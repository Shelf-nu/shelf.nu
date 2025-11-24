import {
  Html,
  Text,
  Link,
  Head,
  render,
  Container,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { LogoForEmail } from "../logo";
import { sendEmail } from "../mail.server";
import { styles } from "../styles";

export const sendTeamTrialWelcomeEmail = async ({
  email,
}: {
  email: string;
}) => {
  try {
    const subject = `Your Shelf Team Trial is Ready - Next Steps`;
    const html = await welcomeToTrialEmailHtml();
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
export const welcomeToTrialEmailText = () => `Dear Shelf user,
Carlos Virreira here, Co-founder of Shelf Asset Management, Inc. I'm thrilled to inform you that your Shelf Team Trial has been activated! This is an excellent step towards more efficient asset management for your team.

To get started with your trial:

Create Your Team Workspace:

Visit https://app.shelf.nu/account-details/workspace to see all your workspaces. You'll find a "NEW WORKSPACE" button enabled - click this to create your team workspace if you haven't already.


Add Your First Assets:
Start populating your inventory to see Shelf in action. Don't forget to try our QR code feature for easy asset tracking.


Invite Team Members:
Collaboration is key. Add your colleagues to truly experience the power of Shelf.


Explore Key Features:
Custom Fields: Tailor Shelf to your specific needs - https://www.shelf.nu/knowledge-base/custom-field-types-in-shelf
Bookings: Efficiently manage equipment reservations - https://www.shelf.nu/knowledge-base/use-case-scenarios-explaing-our-bookings-feature
Kits: Group related assets for easier management - https://www.shelf.nu/features/kits

Need help? Our support team is ready to assist you. Check out our Knowledge Base for quick answers, or reach out directly at ${SUPPORT_EMAIL}.

Remember, your trial gives you full access to all our premium features. Make the most of it!

Happy asset tracking,
Carlos Virreira
Co-founder, Shelf Asset Management, Inc.
P.S. Have questions or feedback? I'd love to hear from you. Reply directly to this email, and let's chat!
`;

function WelcomeToTrialEmailTemplate() {
  const { emailPrimaryColor } = config;

  return (
    <Html>
      <Head>
        <title>Your Shelf Team Trial is Ready - Next Steps</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          Dear Shelf user,
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Carlos Virreira here, Co-founder of Shelf Asset Management, Inc. I'm
            thrilled to inform you that your Shelf Team Trial has been
            activated! This is an excellent step towards more efficient asset
            management for your team.
            <br />
            To get started with your trial:
            <br />
            <h2>Create Your Team Workspace:</h2>
          </Text>
          <ol style={{ ...styles.li }}>
            <li>
              Visit{" "}
              <Link
                href={`${SERVER_URL}/account-details/workspace`}
                style={{ color: emailPrimaryColor }}
              >
                {SERVER_URL}/account-details/workspace
              </Link>{" "}
              to see all your workspaces. You'll find a "NEW WORKSPACE" button
              enabled - click this to create your team workspace if you haven't
              already.
            </li>
            <li>
              Add Your First Assets: Start populating your inventory to see
              Shelf in action. Don't forget to try our QR code feature for easy
              asset tracking.
            </li>
            <li>
              Invite Team Members: Collaboration is key. Add your colleagues to
              truly experience the power of Shelf.
            </li>
          </ol>
          <h2>Explore Key Features:</h2>
          <Link
            href="https://www.shelf.nu/knowledge-base/custom-field-types-in-shelf"
            style={{ color: emailPrimaryColor }}
          >
            Custom Fields: Tailor Shelf to your specific needs
          </Link>
          <br />
          <Link
            href="https://www.shelf.nu/knowledge-base/use-case-scenarios-explaing-our-bookings-feature"
            style={{ color: emailPrimaryColor }}
          >
            Bookings: Efficiently manage equipment reservations
          </Link>
          <br />
          <Link
            href="https://www.shelf.nu/features/kits"
            style={{ color: emailPrimaryColor }}
          >
            Kits: Group related assets for easier management
          </Link>
          <br />
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Need help? Our support team is ready to assist you. Check out our
            Knowledge Base for quick answers, or reach out directly at{" "}
            {SUPPORT_EMAIL}.
            <br />
            Remember, your trial gives you full access to all our premium
            features. Make the most of it!
            <br />
            <br />
            Happy asset tracking, <br />
            Carlos Virreira <br />
            Co-founder, Shelf Asset Management, Inc.
            <br />
            P.S. Have questions or feedback? I'd love to hear from you. Reply
            directly to this email, and let's chat!
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
