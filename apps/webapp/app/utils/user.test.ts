import { describe, expect, it } from "vitest";
import { resolveUserDisplayName, resolveTeamMemberName } from "./user";

describe("resolveUserDisplayName", () => {
  it("returns displayName when set", () => {
    expect(
      resolveUserDisplayName({
        displayName: "Custom Name",
        firstName: "John",
        lastName: "Doe",
      })
    ).toBe("Custom Name");
  });

  it("falls back to firstName + lastName when displayName is null", () => {
    expect(
      resolveUserDisplayName({
        displayName: null,
        firstName: "John",
        lastName: "Doe",
      })
    ).toBe("John Doe");
  });

  it("falls back to firstName + lastName when displayName is undefined", () => {
    expect(resolveUserDisplayName({ firstName: "John", lastName: "Doe" })).toBe(
      "John Doe"
    );
  });

  it("returns only firstName when lastName is missing", () => {
    expect(resolveUserDisplayName({ firstName: "John" })).toBe("John");
  });

  it("returns only lastName when firstName is missing", () => {
    expect(resolveUserDisplayName({ lastName: "Doe" })).toBe("Doe");
  });

  it("returns empty string when user is null", () => {
    expect(resolveUserDisplayName(null)).toBe("");
  });

  it("returns empty string when user is undefined", () => {
    expect(resolveUserDisplayName(undefined)).toBe("");
  });

  it("returns empty string when all fields are null", () => {
    expect(
      resolveUserDisplayName({
        displayName: null,
        firstName: null,
        lastName: null,
      })
    ).toBe("");
  });

  it("trims whitespace from firstName and lastName", () => {
    expect(
      resolveUserDisplayName({ firstName: "  John  ", lastName: "  Doe  " })
    ).toBe("John Doe");
  });

  it("does not use empty string displayName", () => {
    expect(
      resolveUserDisplayName({
        displayName: "",
        firstName: "John",
        lastName: "Doe",
      })
    ).toBe("John Doe");
  });

  it("does not use whitespace-only displayName", () => {
    expect(
      resolveUserDisplayName({
        displayName: "   ",
        firstName: "John",
        lastName: "Doe",
      })
    ).toBe("John Doe");
  });

  it("trims displayName", () => {
    expect(
      resolveUserDisplayName({
        displayName: "  Custom Name  ",
        firstName: "John",
        lastName: "Doe",
      })
    ).toBe("Custom Name");
  });
});

describe("resolveTeamMemberName", () => {
  it("uses displayName from user when available", () => {
    expect(
      resolveTeamMemberName({
        name: "Team Member",
        user: {
          displayName: "Custom Name",
          firstName: "John",
          lastName: "Doe",
        },
      })
    ).toBe("Custom Name");
  });

  it("falls back to firstName + lastName when no displayName", () => {
    expect(
      resolveTeamMemberName({
        name: "Team Member",
        user: { firstName: "John", lastName: "Doe" },
      })
    ).toBe("John Doe");
  });

  it("falls back to teamMember name when no user", () => {
    expect(resolveTeamMemberName({ name: "External Member" })).toBe(
      "External Member"
    );
  });

  it("includes email when requested and user has displayName", () => {
    expect(
      resolveTeamMemberName(
        {
          name: "Team Member",
          user: {
            displayName: "Custom Name",
            firstName: "John",
            lastName: "Doe",
            email: "john@example.com",
          },
        },
        true
      )
    ).toBe("Custom Name (john@example.com)");
  });

  it("includes email with firstName + lastName when no displayName", () => {
    expect(
      resolveTeamMemberName(
        {
          name: "Team Member",
          user: {
            firstName: "John",
            lastName: "Doe",
            email: "john@example.com",
          },
        },
        true
      )
    ).toBe("John Doe (john@example.com)");
  });

  it("falls back to teamMember name when user has no name fields", () => {
    expect(
      resolveTeamMemberName({
        name: "Stored Name",
        user: {},
      })
    ).toBe("Stored Name");
  });
});
