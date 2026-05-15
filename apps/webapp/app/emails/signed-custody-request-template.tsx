import {
  Button,
  Container,
  Head,
  Html,
  render,
  Text,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import { SUPPORT_EMAIL } from "~/utils/env";
import { CustomEmailFooter } from "./components/custom-footer";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";

interface Props {
  assetTitle: string;
  organizationName: string;
  recipientEmail: string;
  recipientName: string;
  signingUrl: string;
  customEmailFooter?: string | null;
}

export function SignedCustodyRequestEmailTemplate({
  assetTitle,
  organizationName,
  recipientEmail,
  recipientName,
  signingUrl,
  customEmailFooter,
}: Props) {
  const { emailPrimaryColor } = config;

  return (
    <Html>
      <Head>
        <title>Signature required for custody assignment</title>
      </Head>

      <Container
        style={{ padding: "32px 16px", maxWidth: "600px", margin: "0 auto" }}
      >
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Howdy {recipientName},
            <br />
            <strong>{organizationName}</strong> needs your signature before{" "}
            <strong>{assetTitle}</strong> can be assigned to your custody.
          </Text>

          <Text style={{ ...styles.p, marginBottom: "24px" }}>
            Review the custody agreement, then type or draw your signature to
            accept responsibility for the asset.
          </Text>

          <Button
            href={signingUrl}
            style={{
              backgroundColor: emailPrimaryColor,
              borderRadius: "6px",
              color: "#ffffff",
              display: "inline-block",
              fontSize: "14px",
              fontWeight: 600,
              padding: "10px 16px",
              textDecoration: "none",
            }}
          >
            Review and sign
          </Button>

          <Text style={{ ...styles.p, marginTop: "24px" }}>
            If you think this is a mistake, contact the workspace administrator
            or Shelf support at {SUPPORT_EMAIL}.
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

export const signedCustodyRequestTemplateString = (props: Props) =>
  render(<SignedCustodyRequestEmailTemplate {...props} />);
