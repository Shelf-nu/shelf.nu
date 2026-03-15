import type { Invite, Organization, User } from "@shelf/database";

export type InviteWithInviterAndOrg = Invite & {
  inviter: Pick<User, "firstName" | "lastName">;
  organization: Organization;
};
