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
        <title>Votre rôle a été modifié</title>
      </Head>

      <Container
        style={{ padding: "32px 16px", maxWidth: "600px", margin: "0 auto" }}
      >
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Bonjour,
            <br />
            Votre rôle dans <strong>{orgName}</strong> a été modifié de{" "}
            <strong>{previousRole}</strong> à <strong>{newRole}</strong>.
          </Text>

          <Text style={{ ...styles.p, marginBottom: "24px" }}>
            Si vous pensez qu'il s'agit d'une erreur, veuillez contacter
            l'administrateur de l'espace de travail. Si vous avez des questions
            ou besoin d'assistance, n'hésitez pas à contacter notre équipe de
            support à {SUPPORT_EMAIL}.
          </Text>

          <Text style={{ marginBottom: "32px", ...styles.p }}>
            Merci, <br />
            L'équipe Shelf
          </Text>

          <CustomEmailFooter footerText={customEmailFooter} />

          <Text style={{ fontSize: "14px", color: "#344054" }}>
            Ceci est un email automatique envoyé par shelf.nu à{" "}
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
