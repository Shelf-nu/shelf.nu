import {
  Button,
  Html,
  Text,
  Head,
  render,
  Container,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import type { InviteWithInviterAndOrg } from "~/modules/invite/types";
import { SERVER_URL } from "~/utils/env";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";

interface Props {
  invite: InviteWithInviterAndOrg;
  token: string;
}

export function InvitationEmailTemplate({ invite, token }: Props) {
  const { emailPrimaryColor } = config;

  return (
    <Html>
      <Head>
        <title>Invitation to join Shelf</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Howdy,
            <br />
            {invite.inviter.firstName} {invite.inviter.lastName} invites you to
            join Shelf as a member of {invite.organization.name}
            ’s workspace. Click the link to accept the invite:
          </Text>
          <Button
            href={`${SERVER_URL}/accept-invite/${invite.id}?token=${token}`}
            style={{ ...styles.button, textAlign: "center" }}
          >
            Accept the invite
          </Button>
          <Text style={{ ...styles.p, marginBottom: "24px" }}>
            Once you’re done setting up your account, you'll be able to access
            the workspace and start exploring features like Asset Explorer,
            Location Tracking, Collaboration, Custom fields and more. If you
            have any questions or need assistance, please don't hesitate to
            contact our support team at support@shelf.nu.
          </Text>
          <Text style={{ marginBottom: "32px", ...styles.p }}>
            Thanks, <br />
            The Shelf team
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
export const invitationTemplateString = ({ token, invite }: Props) =>
  render(<InvitationEmailTemplate token={token} invite={invite} />);
