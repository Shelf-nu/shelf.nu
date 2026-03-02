import type { Invite, Organization, User } from "@prisma/client";

export type InviteWithInviterAndOrg = Invite & {
  inviter: Pick<User, "firstName" | "lastName">;
  organization: Organization;
};
