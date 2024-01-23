import {
  Button,
  Html,
  Text,
  Img,
  Section,
  Link,
  Head,
  render,
} from "@react-email/components";
import type { InviteWithInviterAndOrg } from "~/modules/invite/types";
import { SERVER_URL } from "~/utils/env";
import { styles } from "./styles";

interface Props {
  invite: InviteWithInviterAndOrg;
  token: string;
}

export function InvitationEmailTemplate({ invite, token }: Props) {
  return (
    <Html>
      <Head>
        <title>Invitation to join Shelf as an Administrator</title>
      </Head>

      <Section style={{ padding: "56px" }}>
        <Img
          src="cid:shelf-logo"
          alt="Shelf's logo"
          width="100"
          height="32"
          style={{ marginBottom: "24px" }}
        />
        <div style={{ paddingTop: "8px" }}>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Howdy,
            <br />
            {invite.inviter.firstName} {invite.inviter.lastName} invites you to
            join Shelf as an Administrator for {invite.organization.name}
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
            contact our support team at{" "}
            <Link style={{ color: "#EF6820" }} href="mailto:support@shelf.nu">
              support@shelf.nu
            </Link>
            .
          </Text>
          <Text style={{ marginBottom: "32px", ...styles.p }}>
            Thanks, <br />
            The Shelf team
          </Text>
          <Text style={{ fontSize: "14px", color: "#344054" }}>
            This is an automatic email sent from{" "}
            <Link style={{ color: "#EF6820" }} href="https://www.shelf.nu/">
              shelf.nu
            </Link>{" "}
            to{" "}
            <Link
              style={{ color: "#EF6820" }}
              href={`mailto:${invite.inviteeEmail}`}
            >
              {invite.inviteeEmail}
            </Link>
            .
          </Text>
        </div>
      </Section>
    </Html>
  );
}

export const invitationTemplateString = ({ token, invite }: Props) =>
  render(<InvitationEmailTemplate token={token} invite={invite} />);
