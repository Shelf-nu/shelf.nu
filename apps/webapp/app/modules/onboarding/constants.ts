/**
 * Onboarding form field options
 * These constants define the preset options shown in dropdowns during user onboarding
 */

export const ROLE_OPTIONS = [
  "Operations Manager",
  "IT Administrator",
  "Facilities Manager",
  "Equipment Manager",
  "Office Manager",
  "Business Owner",
  "Project Manager",
  "Personal use", // Allows individual signups to provide a meaningful answer
] as const;

export const TEAM_SIZE_OPTIONS = [
  "Just me (1)",
  "Small team (2-10)",
  "Department (11-50)",
  "Large organization (50+)",
] as const;

export const PRIMARY_USE_CASE_OPTIONS = [
  "IT hardware",
  "Office equipment",
  "Facilities assets",
  "Tools & machinery",
  "Inventory & supplies",
] as const;

export const CURRENT_SOLUTION_OPTIONS = [
  "Spreadsheets",
  "Paper logs",
  "Dedicated asset tool",
  "Not tracking yet",
] as const;

export const TIMELINE_OPTIONS = [
  "This week",
  "Within a month",
  "Next quarter",
  "Just exploring",
] as const;

/**
 * The team-size answers that mean "more than one person will use this
 * workspace". Derived from {@link TEAM_SIZE_OPTIONS} so the two can't drift.
 */
export const MULTI_PERSON_TEAM_SIZES: readonly string[] =
  TEAM_SIZE_OPTIONS.filter((option) => option !== "Just me (1)");

/**
 * Whether an onboarding team-size answer signals the user expects teammates.
 *
 * The team-size field is captured with `SelectWithOther`, so stored values are
 * NOT limited to {@link TEAM_SIZE_OPTIONS}: real data contains free-text
 * answers such as "1". Only the known multi-person options count, so an
 * arbitrary answer never pushes a solo user toward a Team workspace.
 *
 * @param teamSize - The stored `UserBusinessIntel.teamSize` value, if any
 * @returns true when the answer is a known multi-person option
 */
export function signalsTeamIntent(
  teamSize: string | null | undefined
): boolean {
  return !!teamSize && MULTI_PERSON_TEAM_SIZES.includes(teamSize);
}

export type RoleOption = (typeof ROLE_OPTIONS)[number];
export type TeamSizeOption = (typeof TEAM_SIZE_OPTIONS)[number];
export type PrimaryUseCaseOption = (typeof PRIMARY_USE_CASE_OPTIONS)[number];
export type CurrentSolutionOption = (typeof CURRENT_SOLUTION_OPTIONS)[number];
export type TimelineOption = (typeof TIMELINE_OPTIONS)[number];
