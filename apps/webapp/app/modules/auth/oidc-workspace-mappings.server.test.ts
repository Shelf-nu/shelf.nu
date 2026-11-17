/**
 * Tests for the `OIDC_WORKSPACE_MAPPINGS` configuration: what the parser
 * accepts and refuses, and which role a set of IdP groups resolves to.
 *
 * @see {@link file://./oidc-workspace-mappings.server.ts}
 */
import { describe, expect, it } from "vitest";
import { ShelfError } from "~/utils/error";
import {
  canCreateMappedWorkspace,
  getRoleFromOidcGroups,
  parseOidcWorkspaceMappings,
} from "./oidc-workspace-mappings.server";

/** A valid configuration with one workspace. */
const VALID = JSON.stringify([
  {
    key: "it-department",
    name: "IT Department",
    currency: "EUR",
    roles: {
      ADMIN: ["it-admins"],
      SELF_SERVICE: ["IT-Staff "],
      BASE: ["all-employees"],
    },
  },
]);

/**
 * Parses a configuration expected to be refused and returns the error.
 *
 * @param raw - The raw configuration value
 * @returns The ShelfError the parser threw
 */
function parseExpectingRefusal(raw: string): ShelfError {
  try {
    parseOidcWorkspaceMappings(raw);
  } catch (cause) {
    expect(cause).toBeInstanceOf(ShelfError);
    return cause as ShelfError;
  }
  throw new Error("Expected the configuration to be refused");
}

describe("parseOidcWorkspaceMappings", () => {
  it("treats an unset or blank value as no mappings", () => {
    expect(parseOidcWorkspaceMappings(undefined)).toEqual([]);
    expect(parseOidcWorkspaceMappings("")).toEqual([]);
    expect(parseOidcWorkspaceMappings("  \n")).toEqual([]);
  });

  it("parses a workspace and normalises its group names", () => {
    expect(parseOidcWorkspaceMappings(VALID)).toEqual([
      {
        key: "it-department",
        name: "IT Department",
        currency: "EUR",
        roles: {
          ADMIN: ["it-admins"],
          SELF_SERVICE: ["it-staff"],
          BASE: ["all-employees"],
        },
      },
    ]);
  });

  it("refuses a value that is not JSON", () => {
    const error = parseExpectingRefusal("[{");
    expect(error.message).toBe("OIDC_WORKSPACE_MAPPINGS is not valid JSON");
  });

  it("refuses a role a group mapping may not confer", () => {
    const error = parseExpectingRefusal(
      JSON.stringify([
        { key: "it", name: "IT", roles: { OWNER: ["it-admins"] } },
      ])
    );
    expect(error.message).toContain("OIDC_WORKSPACE_MAPPINGS is invalid");
    expect(error.message).toContain("OWNER");
  });

  it("refuses two workspaces with the same key", () => {
    const error = parseExpectingRefusal(
      JSON.stringify([
        { key: "it", name: "IT", roles: {} },
        { key: "it", name: "IT again", roles: {} },
      ])
    );
    expect(error.message).toContain('key "it" is used more than once');
  });

  it("refuses a key that is not a lowercase identifier", () => {
    const error = parseExpectingRefusal(
      JSON.stringify([{ key: "IT Department", name: "IT", roles: {} }])
    );
    expect(error.message).toContain("0.key");
  });

  it("refuses an unknown currency and an unknown field", () => {
    expect(
      parseExpectingRefusal(
        JSON.stringify([{ key: "it", name: "IT", currency: "EURO", roles: {} }])
      ).message
    ).toContain("0.currency");
    expect(
      parseExpectingRefusal(
        JSON.stringify([{ key: "it", name: "IT", roles: {}, role: {} }])
      ).message
    ).toContain("OIDC_WORKSPACE_MAPPINGS is invalid");
  });
});

describe("getRoleFromOidcGroups", () => {
  const [mapping] = parseOidcWorkspaceMappings(VALID);

  it("resolves the role of a matching group", () => {
    expect(getRoleFromOidcGroups(mapping, ["all-employees"])).toBe("BASE");
  });

  it("compares group names without regard to case or padding", () => {
    expect(getRoleFromOidcGroups(mapping, [" it-STAFF"])).toBe("SELF_SERVICE");
  });

  it("lets the most privileged matching role win", () => {
    expect(
      getRoleFromOidcGroups(mapping, ["all-employees", "it-admins", "it-staff"])
    ).toBe("ADMIN");
  });

  it("resolves no role when no group matches", () => {
    expect(getRoleFromOidcGroups(mapping, ["finance"])).toBeNull();
    expect(getRoleFromOidcGroups(mapping, [])).toBeNull();
  });
});

describe("canCreateMappedWorkspace", () => {
  const [mapping] = parseOidcWorkspaceMappings(VALID);

  it("allows a member of an administrator group", () => {
    expect(canCreateMappedWorkspace(mapping, ["IT-Admins"])).toBe(true);
  });

  it("refuses every other member", () => {
    expect(canCreateMappedWorkspace(mapping, ["it-staff"])).toBe(false);
    expect(canCreateMappedWorkspace(mapping, [])).toBe(false);
  });
});
