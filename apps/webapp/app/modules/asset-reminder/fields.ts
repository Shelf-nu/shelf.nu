import type { Sb } from "@shelf/database";

/**
 * Supabase select string for AssetReminder with related asset and team members.
 *
 * The join table `_AssetReminderToTeamMember` links reminders to team members,
 * and each team member may have an associated User.
 */
export const ASSET_REMINDER_SELECT_WITH_RELATIONS = `
  *,
  asset:Asset!inner(id, title),
  teamMembers:_AssetReminderToTeamMember(
    teamMember:TeamMember(
      id,
      name,
      user:User(firstName, lastName, profilePicture, email, id)
    )
  )
`
  .replace(/\s+/g, " ")
  .trim();

/**
 * Supabase select string for AssetReminder with fields needed for emails.
 */
export const ASSET_REMINDER_SELECT_FOR_EMAIL = `
  *,
  asset:Asset!inner(id, title, mainImage, mainImageExpiration),
  teamMembers:_AssetReminderToTeamMember(
    teamMember:TeamMember(
      user:User(email, firstName, lastName)
    )
  ),
  organization:Organization!inner(name, customEmailFooter)
`
  .replace(/\s+/g, " ")
  .trim();

/** Shape of a team member entry after flattening the join-table result. */
type ReminderTeamMember = {
  id: string;
  name: string;
  user: {
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
    email: string;
    id: string;
  } | null;
};

/**
 * Type for an AssetReminder row with its standard relations (asset + team members).
 * This replaces the old `Prisma.AssetReminderGetPayload<{ include: typeof ASSET_REMINDER_INCLUDE_FIELDS }>`.
 */
export type AssetReminderWithRelations = Sb.AssetReminderRow & {
  asset: { id: string; title: string };
  teamMembers: ReminderTeamMember[];
};

/** Shape of a team member entry from the email select (user fields only). */
type ReminderTeamMemberForEmail = {
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

/** Type for an AssetReminder with relations needed for sending emails. */
export type AssetReminderForEmail = Sb.AssetReminderRow & {
  asset: {
    id: string;
    title: string;
    mainImage: string | null;
    mainImageExpiration: string | null;
  };
  teamMembers: ReminderTeamMemberForEmail[];
  organization: { name: string; customEmailFooter: string | null };
};

/**
 * Raw shape returned by Supabase for ASSET_REMINDER_SELECT_WITH_RELATIONS
 * before flattening the join table.
 */
export type RawAssetReminderWithRelations = Sb.AssetReminderRow & {
  asset: { id: string; title: string };
  teamMembers: { teamMember: ReminderTeamMember }[];
};

/**
 * Raw shape returned by Supabase for ASSET_REMINDER_SELECT_FOR_EMAIL
 * before flattening the join table.
 */
export type RawAssetReminderForEmail = Sb.AssetReminderRow & {
  asset: {
    id: string;
    title: string;
    mainImage: string | null;
    mainImageExpiration: string | null;
  };
  teamMembers: { teamMember: ReminderTeamMemberForEmail }[];
  organization: { name: string; customEmailFooter: string | null };
};

/**
 * Flatten the nested join-table structure returned by Supabase into the
 * simpler `teamMembers` array that the rest of the app expects.
 *
 * Supabase returns:
 *   `teamMembers: [{ teamMember: { id, name, user } }]`
 *
 * We flatten to:
 *   `teamMembers: [{ id, name, user }]`
 */
export function flattenReminderTeamMembers<
  T extends {
    teamMembers: { teamMember: Record<string, unknown> }[];
  },
>(
  reminder: T
): Omit<T, "teamMembers"> & {
  teamMembers: T["teamMembers"][number]["teamMember"][];
} {
  return {
    ...reminder,
    teamMembers: reminder.teamMembers.map((jt) => jt.teamMember),
  };
}
