import type { CustomField } from "@prisma/client";

/**
 * Factory for creating CustomField test data.
 * Produces a complete, active, text-typed CustomField row with no options.
 */
export function createCustomField(
  overrides: Partial<CustomField> = {}
): CustomField {
  return {
    id: "custom-field-123",
    name: "Serial number",
    helpText: null,
    required: false,
    active: true,
    type: "TEXT",
    options: [],
    organizationId: "org-123",
    userId: "user-123",
    createdAt: new Date("2023-01-01"),
    updatedAt: new Date("2023-01-01"),
    deletedAt: null,
    ...overrides,
  };
}
