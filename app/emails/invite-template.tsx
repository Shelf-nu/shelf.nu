import {
  Button,
  Html,
  Text,
  Head,
  render,
  Container,
  Section,
  Img,
  Link,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import type { InviteWithInviterAndOrg } from "~/modules/invite/types";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";

interface Props {
  invite: InviteWithInviterAndOrg;
  token: string;
  extraMessage?: string | null;
}

export function InvitationEmailTemplate({
  invite,
  token,
  extraMessage,
}: Props) {
  const { emailPrimaryColor } = config;
  return (
    <Html>
      <Head>
        <title>Invitation to join Shelf</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ marginBottom: "12px", ...styles.p }}>Howdy,</Text>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            {invite.inviter.firstName} {invite.inviter.lastName} invited you to
            their Shelf workspace: <strong>{invite.organization.name}</strong>.
          </Text>

          {extraMessage ? (
            <Section
              style={{
                padding: "10px",
                borderRadius: "12px",
                border: "1px solid #FEC84B",
                backgroundColor: "#FFFCF5",
                marginBottom: "24px",
              }}
            >
              <Img
                src={`${SERVER_URL}/static/images/circle-alert.png`}
                alt="alert-icon"
                style={{ width: "16px", height: "16px", marginBottom: "10px" }}
              />

              <Text
                style={{
                  fontSize: "16px",
                  fontWeight: "bold",
                  color: "#B54708",
                  margin: "0px",
                }}
              >
                Message from sender, please read carefully.
              </Text>

              <Text
                style={{
                  fontSize: "16px",
                  color: "#B54708",
                  margin: "0px",
                }}
              >
                {extraMessage}
              </Text>
            </Section>
          ) : null}

          <Button
            href={`${SERVER_URL}/accept-invite/${invite.id}?token=${token}`}
            style={{ ...styles.button, textAlign: "center" }}
          >
            Accept the invite
          </Button>
          <Text style={{ ...styles.p, marginTop: "24px" }}>
            <strong>What is Shelf?</strong> Asset tracking that doesn't suck. QR
            codes, bookings, team collaboration – the stuff spreadsheets can't
            do.
          </Text>
          <ul style={{ textAlign: "left", paddingLeft: "24px" }}>
            <li>See all assets in {invite.organization.name}</li>
            <li>Create bookings</li>
            <li>Track locations</li>
            <li>Collaborate with your team</li>
          </ul>
          <Text style={{ ...styles.p, marginBottom: "24px" }}>
            Questions? {SUPPORT_EMAIL}
          </Text>

          <Text style={{ marginBottom: "32px", ...styles.p }}>
            Thanks, <br />
            The Shelf team
          </Text>
          <Text style={{ ...styles.p, marginBottom: "16px" }}>
            P.S. - Need labels?{" "}
            <Link
              href="http://store.shelf.nu"
              style={{ color: emailPrimaryColor }}
            >
              http://store.shelf.nu
            </Link>
          </Text>
          <Text style={{ fontSize: "14px", color: "#344054" }}>
            This is an automatic email sent from shelf.nu to{" "}
            <span style={{ color: emailPrimaryColor }}>
              {invite.inviteeEmail}
            </span>
            .
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
export const invitationTemplateString = ({
  token,
  invite,
  extraMessage,
}: Props) =>
  render(
    <InvitationEmailTemplate
      token={token}
      invite={invite}
      extraMessage={extraMessage}
    />
  );
