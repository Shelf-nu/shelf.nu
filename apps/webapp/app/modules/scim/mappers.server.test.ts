import { describe, expect, it } from "vitest";
import { userToScimResource } from "~/modules/scim/mappers.server";
import { SCIM_SCHEMA_USER } from "~/modules/scim/types";

const baseUser = {
  id: "user-abc-123",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  scimExternalIds: [{ scimExternalId: "entra-id-456" }],
  createdAt: new Date("2024-06-01T10:00:00Z"),
  updatedAt: new Date("2024-06-15T12:00:00Z"),
};

describe("userToScimResource", () => {
  it("should map a complete user to a SCIM resource", () => {
    const result = userToScimResource(baseUser, true);

    expect(result).toEqual({
      schemas: [SCIM_SCHEMA_USER],
      id: "user-abc-123",
      externalId: "entra-id-456",
      userName: "jane@example.com",
      name: {
        givenName: "Jane",
        familyName: "Doe",
        formatted: "Jane Doe",
      },
      displayName: "Jane Doe",
      emails: [{ value: "jane@example.com", type: "work", primary: true }],
      active: true,
      meta: {
        resourceType: "User",
        created: "2024-06-01T10:00:00.000Z",
        lastModified: "2024-06-15T12:00:00.000Z",
        location: "http://localhost:3000/api/scim/v2/Users/user-abc-123",
      },
    });
  });

  it("should set active to false when user is inactive", () => {
    const result = userToScimResource(baseUser, false);

    expect(result.active).toBe(false);
  });

  it("should omit externalId when null", () => {
    const user = { ...baseUser, scimExternalIds: [] };
    const result = userToScimResource(user, true);

    expect(result.externalId).toBeUndefined();
  });

  it("should use email as displayName when no name is present", () => {
    const user = { ...baseUser, firstName: null, lastName: null };
    const result = userToScimResource(user, true);

    expect(result.displayName).toBe("jane@example.com");
  });

  it("should omit formatted name when displayName equals email", () => {
    const user = { ...baseUser, firstName: null, lastName: null };
    const result = userToScimResource(user, true);

    expect(result.name?.formatted).toBeUndefined();
  });

  it("should handle user with only firstName", () => {
    const user = { ...baseUser, lastName: null };
    const result = userToScimResource(user, true);

    expect(result.displayName).toBe("Jane");
    expect(result.name).toEqual({
      givenName: "Jane",
      familyName: undefined,
      formatted: "Jane",
    });
  });

  it("should handle user with only lastName", () => {
    const user = { ...baseUser, firstName: null };
    const result = userToScimResource(user, true);

    expect(result.displayName).toBe("Doe");
    expect(result.name).toEqual({
      givenName: undefined,
      familyName: "Doe",
      formatted: "Doe",
    });
  });

  it("should set givenName and familyName to undefined for null values", () => {
    const user = { ...baseUser, firstName: null, lastName: null };
    const result = userToScimResource(user, true);

    expect(result.name?.givenName).toBeUndefined();
    expect(result.name?.familyName).toBeUndefined();
  });

  it("should include correct meta.location URL", () => {
    const result = userToScimResource(baseUser, true);

    expect(result.meta.location).toBe(
      "http://localhost:3000/api/scim/v2/Users/user-abc-123"
    );
  });

  it("should serialize dates as ISO strings", () => {
    const result = userToScimResource(baseUser, true);

    expect(result.meta.created).toBe("2024-06-01T10:00:00.000Z");
    expect(result.meta.lastModified).toBe("2024-06-15T12:00:00.000Z");
  });
});
