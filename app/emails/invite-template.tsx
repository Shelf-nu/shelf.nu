import {
  Button,
  Html,
  Tailwind,
  Text,
  Img,
  Section,
  Link,
  Head,
  render,
} from "@react-email/components";
import tailwindConfig from "tailwind.config";
import type { InviteWithInviterAndOrg } from "~/modules/invite/types";
import { SERVER_URL } from "~/utils/env";

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
      <Tailwind config={tailwindConfig}>
        <Section className="p-14">
          <Img
            src="cid:shelf-logo"
            alt="Shelf's logo"
            width="100"
            height="32"
            className="mb-6"
          />
          <div className="py-8">
            <Text className="mb-6 text-[16px] text-gray-700">
              Howdy,
              <br />
              {invite.inviter.firstName} {invite.inviter.lastName} invites you
              to join Shelf as an Administrator for {invite.organization.name}
              ’s workspace. Click the link to accept the invite:
            </Text>
            <Button
              href={`${SERVER_URL}/accept-invite/${invite.id}?token=${token}`}
              className="box-shadow-xs mb-6 inline-flex max-w-xl items-center justify-center gap-2 rounded border border-primary-400 bg-primary-500 px-4 py-[10px] text-center text-[14px] font-semibold text-white focus:ring-2 hover:bg-primary-400"
            >
              Accept the invite
            </Button>
            <Text className="mb-6 text-[16px] text-gray-700">
              Once you’re done setting up your account, you'll be able to access
              the workspace and start exploring features like Asset Explorer,
              Location Tracking, Collaboration, Custom fields and more. If you
              have any questions or need assistance, please don't hesitate to
              contact our support team at{" "}
              <Link className="text-primary-700" href="mailto:support@shelf.nu">
                support@shelf.nu
              </Link>
              .
            </Text>
            <Text className="mb-8 text-[16px] text-gray-700">
              Thanks, <br />
              The Shelf team
            </Text>
            <Text className="text-[14px] text-gray-700">
              This is an automatic email sent from{" "}
              <Link className="text-primary-700" href="https://www.shelf.nu/">
                shelf.nu
              </Link>{" "}
              to{" "}
              <Link
                className="text-primary-700"
                href={`mailto:${invite.inviteeEmail}`}
              >
                {invite.inviteeEmail}
              </Link>
              .
            </Text>
          </div>
        </Section>
      </Tailwind>
    </Html>
  );
}

export const invitationTemplateString = ({ token, invite }: Props) =>
  render(<InvitationEmailTemplate token={token} invite={invite} />);
