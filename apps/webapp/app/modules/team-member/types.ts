import type { TeamMember, User } from "@shelf/database";

export type TeamMemberWithUser = TeamMember & {
  user: User | null;
};
