import type { Invite, Organization } from "@prisma/client";

export type InviteWithInviterAndOrg = Invite & {
  inviter: { firstName: string | null; lastName: string | null };
  organization: Organization;
};
