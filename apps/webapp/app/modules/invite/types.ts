import type { Sb } from "@shelf/database";

export type InviteWithInviterAndOrg = Sb.InviteRow & {
  inviter: { firstName: string | null; lastName: string | null };
  organization: Sb.OrganizationRow;
};
