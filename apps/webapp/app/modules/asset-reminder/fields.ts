/**
 * Supabase select string for asset reminder joins.
 * Replaces the Prisma include pattern with Supabase join syntax.
 */
export const ASSET_REMINDER_SELECT_FIELDS =
  "*, asset:Asset(id, title), teamMembers:AssetReminderToTeamMember(teamMember:TeamMember(id, name, user:User(firstName, lastName, profilePicture, email, id)))";
