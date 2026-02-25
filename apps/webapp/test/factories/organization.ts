import type { Organization, OrganizationType } from "@prisma/client";

/**
 * Factory for creating Organization test data
 */
export function createOrganization(
  overrides: Partial<Organization> = {}
): Partial<Organization> {
  return {
    id: "org-123",
    name: "Test Organization",
    type: "PERSONAL" as OrganizationType,
    imageId: null,
    userId: "user-123",
    currency: "USD",
    createdAt: new Date("2023-01-01"),
    updatedAt: new Date("2023-01-01"),
    ...overrides,
  };
}

/**
 * Common organization ID for consistent test data
 */
export const ORGANIZATION_ID = "59a13863-585b-57bf-8d90-2074f1817875";
