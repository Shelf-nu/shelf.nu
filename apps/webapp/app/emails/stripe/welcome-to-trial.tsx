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

interface TeamTrialWelcomeProps {
  firstName?: string | null;
  email: string;
}

export const sendTeamTrialWelcomeEmail = async ({
  firstName,
  email,
}: TeamTrialWelcomeProps) => {
  try {
    const subject = "Your Shelf Team Trial is Ready - Next Steps";
    const html = await welcomeToTrialEmailHtml({ firstName });
    const text = welcomeToTrialEmailText({ firstName });

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

export const welcomeToTrialEmailText = ({
  firstName,
}: {
  firstName?: string | null;
}) => `Hey${firstName ? ` ${firstName}` : ""},

Carlos Virreira here, Co-founder of Shelf Asset Management, Inc. I'm thrilled to inform you that your Shelf Team Trial has been activated! This is an excellent step towards more efficient asset management for your team.

To get started with your trial:

1. Create Your Team Workspace
Visit ${SERVER_URL}/account-details/workspace to see all your workspaces. Click "NEW WORKSPACE" to create your team workspace.

2. Add Your First Assets
Start populating your inventory to see Shelf in action. Try our QR code feature for easy asset tracking.

3. Invite Team Members
Collaboration is key. Add your colleagues to truly experience the power of Shelf.

Explore Key Features:
- Custom Fields: Tailor Shelf to your specific needs - https://www.shelf.nu/knowledge-base/custom-field-types-in-shelf
- Bookings: Efficiently manage equipment reservations - https://www.shelf.nu/knowledge-base/use-case-scenarios-explaing-our-bookings-feature
- Kits: Group related assets for easier management - https://www.shelf.nu/features/kits

Need help? Check out our Knowledge Base for quick answers, or reach out to us at ${SUPPORT_EMAIL}.

Remember, your trial gives you full access to all premium features. Make the most of it!

Happy asset tracking,
The Shelf Team
`;

function WelcomeToTrialEmailTemplate({
  firstName,
}: {
  firstName?: string | null;
}) {
  const { emailPrimaryColor } = config;

  return (
    <Html>
      <Head>
        <title>Your Shelf Team Trial is Ready - Next Steps</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Hey{firstName ? ` ${firstName}` : ""},
          </Text>

          <Text style={{ ...styles.p }}>
            Carlos Virreira here, Co-founder of Shelf Asset Management, Inc. I'm
            thrilled to inform you that your <strong>Shelf Team Trial</strong>{" "}
            has been activated! This is an excellent step towards more efficient
            asset management for your team.
          </Text>

          <Text style={{ ...styles.h2 }}>To get started with your trial:</Text>

          <ol style={{ ...styles.li, paddingLeft: "20px" }}>
            <li style={{ marginBottom: "12px" }}>
              <strong>Create Your Team Workspace:</strong> Visit your{" "}
              <Link
                href={`${SERVER_URL}/account-details/workspace`}
                style={{ color: emailPrimaryColor }}
              >
                workspace settings
              </Link>{" "}
              and click "NEW WORKSPACE" to create your team workspace.
            </li>
            <li style={{ marginBottom: "12px" }}>
              <strong>Add Your First Assets:</strong> Start populating your
              inventory to see Shelf in action. Try our QR code feature for easy
              asset tracking.
            </li>
            <li style={{ marginBottom: "12px" }}>
              <strong>Invite Team Members:</strong> Collaboration is key. Add
              your colleagues to truly experience the power of Shelf.
            </li>
          </ol>

          <Button
            href={`${SERVER_URL}/account-details/workspace`}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "250px",
              marginBottom: "24px",
            }}
          >
            Create your workspace
          </Button>

          <Text style={{ ...styles.h2 }}>Explore Key Features:</Text>

          <Text style={{ ...styles.p }}>
            <Link
              href="https://www.shelf.nu/knowledge-base/custom-field-types-in-shelf"
              style={{ color: emailPrimaryColor }}
            >
              Custom Fields
            </Link>
            : Tailor Shelf to your specific needs
          </Text>

          <Text style={{ ...styles.p }}>
            <Link
              href="https://www.shelf.nu/knowledge-base/use-case-scenarios-explaing-our-bookings-feature"
              style={{ color: emailPrimaryColor }}
            >
              Bookings
            </Link>
            : Efficiently manage equipment reservations
          </Text>

          <Text style={{ ...styles.p }}>
            <Link
              href="https://www.shelf.nu/features/kits"
              style={{ color: emailPrimaryColor }}
            >
              Kits
            </Link>
            : Group related assets for easier management
          </Text>

          <Text style={{ marginTop: "24px", ...styles.p }}>
            Need help? Check out our Knowledge Base for quick answers, or reach
            out to us at {SUPPORT_EMAIL}.
          </Text>

          <Text style={{ ...styles.p }}>
            Remember, your trial gives you full access to all premium features.
            Make the most of it!
          </Text>

          <Text style={{ marginTop: "24px", ...styles.p }}>
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

export const welcomeToTrialEmailHtml = ({
  firstName,
}: {
  firstName?: string | null;
}) => render(<WelcomeToTrialEmailTemplate firstName={firstName} />);
