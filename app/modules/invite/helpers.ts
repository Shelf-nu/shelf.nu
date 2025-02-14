import { SERVER_URL } from "~/utils/env";
import type { InviteWithInviterAndOrg } from "./types";

export function generateRandomCode(length: number): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters.charAt(randomIndex);
  }
  return code;
}

export const inviteEmailText = ({
  invite,
  token,
  extraMessage,
}: {
  invite: InviteWithInviterAndOrg;
  token: string;
  extraMessage?: string | null;
}) => `Howdy,

${invite.inviter.firstName} ${
  invite.inviter.lastName
} invites you to join Shelf as a member of ${
  invite.organization.name
}’s workspace.

Click the link to accept the invite:
${SERVER_URL}/accept-invite/${invite.id}?token=${token}

Once you’re done setting up your account, you'll be able to access the workspace and start exploring features like Asset Explorer, Location Tracking, Collaboration, Custom fields and more.

If you have any questions or need assistance, please don't hesitate to contact our support team at support@shelf.nu.

${extraMessage ? extraMessage : ""}

Thanks,
The Shelf Team
`;

export const revokeAccessEmailText = ({
  orgName,
}: {
  orgName: string;
}) => `Howdy,

Your access to ${orgName} has been revoked.

If you think this is a mistake, please contact the organization’s administrator.

Thanks,
The Shelf Team
`;

export const assetCustodyAssignedEmailText = ({
  assetName,
  assignerName,
  assetId,
}: {
  assetName: string;
  assignerName: string;
  assetId: string;
}) => `Howdy,

${assignerName} has assigned you as custodian for ${assetName}.
Please click the link below to view the asset:
${SERVER_URL}/assets/${assetId}

Thanks,
The Shelf Team
`;

export const assetCustodyRevokedEmailText = ({
  assetName,
  assignerName,
  assetId,
}: {
  assetName: string;
  assignerName: string;
  assetId: string;
}) => `Howdy,

${assignerName} has revoked your custody for ${assetName}.
Please click the link below to view the asset:
${SERVER_URL}/assets/${assetId}

Thanks,
The Shelf Team
`;

export const assetCustodySignatureRequiredEmailText = ({
  assetName,
  assignerName,
  assetId,
  templateId,
  assigneeId,
}: {
  assetName: string;
  assignerName: string;
  assetId: string;
  templateId: string;
  assigneeId: string;
}) => `Howdy,

${assignerName} has requested your signature for ${assetName}.
Please click the link below to view the signing template:
${SERVER_URL}/sign/${templateId}?assigneeId=${assigneeId}&assetId=${assetId}

To view the asset, please click the link below:
${SERVER_URL}/assets/${assetId}

Thanks,
The Shelf Team
`;

export const assetCustodyAssignedWithTemplateEmailText = ({
  assetName,
  assignerName,
  assetId,
  templateId,
  assigneeId,
}: {
  assetName: string;
  assignerName: string;
  assetId: string;
  templateId: string;
  assigneeId: string;
}) => `Howdy,

${assignerName} has assigned you as custodian for ${assetName}.
Please click the link below to view the signing template:
${SERVER_URL}/sign/${templateId}?assigneeId=${assigneeId}&assetId=${assetId}

To view the asset, please click the link below:
${SERVER_URL}/assets/${assetId}

Thanks,
The Shelf Team
`;
