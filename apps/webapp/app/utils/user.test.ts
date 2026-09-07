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

  it("refuses a projection that omits displayName", () => {
    // The failure this guards is invisible at runtime: a projection that drops
    // `displayName` still resolves to a perfectly plausible name — the user's
    // legal one — so no assertion can tell the two apart. The compiler has to
    // be the guard, and this is the only thing enforcing it.
    //
    // The directive below IS that guard: make `displayName` optional again and
    // it stops suppressing anything, so `tsc` fails on an unused directive.
    // (Keep any mention of the directive off the start of a comment line —
    // TypeScript reads one there as real, wherever it appears.)
    // @ts-expect-error - displayName is deliberately required
    const result = resolveUserDisplayName({
      firstName: "John",
      lastName: "Doe",
    });

    // Still resolves at runtime — which is exactly why the type must object.
    expect(result).toBe("John Doe");
  });

  it("returns only firstName when lastName is missing", () => {
    expect(
      resolveUserDisplayName({ displayName: null, firstName: "John" })
    ).toBe("John");
  });

  it("returns only lastName when firstName is missing", () => {
    expect(resolveUserDisplayName({ displayName: null, lastName: "Doe" })).toBe(
      "Doe"
    );
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
      resolveUserDisplayName({
        displayName: null,
        firstName: "  John  ",
        lastName: "  Doe  ",
      })
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
        user: { displayName: null, firstName: "John", lastName: "Doe" },
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
            displayName: null,
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
        user: { displayName: null },
      })
    ).toBe("Stored Name");
  });
});
