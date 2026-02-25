import { Html, Text, Head, render, Container } from "@react-email/components";
import { config } from "~/config/shelf.config";
import { SUPPORT_EMAIL } from "~/utils/env";
import { CustomEmailFooter } from "./components/custom-footer";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";

interface Props {
  orgName: string;
  previousRole: string;
  newRole: string;
  recipientEmail: string;
  customEmailFooter?: string | null;
}

export function RoleChangeEmailTemplate({
  orgName,
  previousRole,
  newRole,
  recipientEmail,
  customEmailFooter,
}: Props) {
  const { emailPrimaryColor } = config;
  return (
    <Html>
      <Head>
        <title>Your role has been changed</title>
      </Head>

      <Container
        style={{ padding: "32px 16px", maxWidth: "600px", margin: "0 auto" }}
      >
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Howdy,
            <br />
            Your role in <strong>{orgName}</strong> has been changed from{" "}
            <strong>{previousRole}</strong> to <strong>{newRole}</strong>.
          </Text>

          <Text style={{ ...styles.p, marginBottom: "24px" }}>
            If you think this is a mistake, please contact the workspace
            administrator. If you have any questions or need assistance, please
            don't hesitate to contact our support team at {SUPPORT_EMAIL}.
          </Text>

          <Text style={{ marginBottom: "32px", ...styles.p }}>
            Thanks, <br />
            The Shelf team
          </Text>

          <CustomEmailFooter footerText={customEmailFooter} />

          <Text style={{ fontSize: "14px", color: "#344054" }}>
            This is an automatic email sent from shelf.nu to{" "}
            <span style={{ color: emailPrimaryColor }}>{recipientEmail}</span>.
          </Text>
        </div>
      </Container>
    </Html>
  );
}

/*
 * The HTML content of an email will be accessed by a server file to send email,
 * we cannot import a TSX component in a server file so we are exporting TSX
 * converted to HTML string using render function by react-email.
 */
export const roleChangeTemplateString = (props: Props) =>
  render(<RoleChangeEmailTemplate {...props} />);
