import type { TeamMember, Organization } from "@prisma/client";

/**
 * Factory for creating TeamMember test data
 */
export function createTeamMember(
  overrides: Partial<TeamMember> = {}
): TeamMember {
  return {
    id: "team-member-123",
    userId: "user-456",
    name: "John Doe",
    organizationId: "org-789" as Organization["id"],
    deletedAt: null,
    createdAt: new Date("2023-01-01"),
    updatedAt: new Date("2023-01-01"),
    ...overrides,
  };
}
