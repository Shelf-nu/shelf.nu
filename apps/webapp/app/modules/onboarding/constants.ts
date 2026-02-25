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

export type RoleOption = (typeof ROLE_OPTIONS)[number];
export type TeamSizeOption = (typeof TEAM_SIZE_OPTIONS)[number];
export type PrimaryUseCaseOption = (typeof PRIMARY_USE_CASE_OPTIONS)[number];
export type CurrentSolutionOption = (typeof CURRENT_SOLUTION_OPTIONS)[number];
export type TimelineOption = (typeof TIMELINE_OPTIONS)[number];
