import { describe, expect, it } from "vitest";
import { MAX_REPORTED_ROW_ERRORS } from "~/utils/import-row-errors";
import {
  MAX_IMPORT_USERS_ROWS,
  validateImportUserRows,
  type ImportUserCsvRow,
} from "./import-users-preflight.server";

/** Validates rows against a workspace with the given team members. */
function validate(
  rows: ImportUserCsvRow[],
  {
    teamMemberIds = [],
    ssoRefusals = {},
  }: { teamMemberIds?: string[]; ssoRefusals?: Record<string, string> } = {}
) {
  return validateImportUserRows({
    rows,
    workspaceTeamMemberIds: new Set(teamMemberIds),
    ssoRefusalByEmail: new Map(Object.entries(ssoRefusals)),
  });
}

describe("validateImportUserRows", () => {
  it("passes a clean file and reads each row the way invites compare it", () => {
    const result = validate(
      [
        { role: "admin", email: " First.Last@School.org " },
        { role: "BASE", email: "member@school.org", teamMemberId: "tm-1" },
      ],
      { teamMemberIds: ["tm-1"] }
    );

    expect(result.errors).toEqual([]);
    expect(result.validRows).toEqual([
      {
        row: 2,
        email: "first.last@school.org",
        role: "ADMIN",
        teamMemberId: null,
        // Kept as typed: it seeds the first name of the invitee's account.
        name: "First.Last",
      },
      {
        row: 3,
        email: "member@school.org",
        role: "BASE",
        teamMemberId: "tm-1",
        name: "member",
      },
    ]);
  });

  it("refuses a row whose email is not an address", () => {
    const result = validate([{ role: "BASE", email: "Evan Williams" }]);

    expect(result.errors).toEqual([
      {
        row: 2,
        title: "Invalid email",
        message: '"Evan Williams" is not a valid email address.',
      },
    ]);
    expect(result.validRows).toEqual([]);
  });

  it("refuses a blank email and a blank role", () => {
    const result = validate([{ role: "", email: "   " }]);

    expect(result.errors.map((error) => error.title)).toEqual([
      "Missing role",
      "Missing email",
    ]);
  });

  it("refuses a role an invite cannot grant", () => {
    const result = validate([{ role: "OWNER", email: "a@school.org" }]);

    expect(result.errors).toEqual([
      expect.objectContaining({ row: 2, title: "Invalid role" }),
    ]);
  });

  it("refuses the later row of an address listed twice, whatever its case", () => {
    const result = validate([
      { role: "BASE", email: "First.Last@School.org" },
      { role: "BASE", email: "first.last@school.org" },
    ]);

    expect(result.errors).toEqual([
      {
        row: 3,
        title: "Duplicate email",
        message:
          "first.last@school.org is already on row 2. Each person can be invited once.",
      },
    ]);
  });

  it("refuses a team member that is not in this workspace", () => {
    // Unknown here covers an id that exists in another workspace too: the
    // lookup that fills the set is scoped to the importing workspace.
    const result = validate(
      [{ role: "BASE", email: "a@school.org", teamMemberId: "tm-elsewhere" }],
      { teamMemberIds: ["tm-1"] }
    );

    expect(result.errors).toEqual([
      {
        row: 2,
        title: "Unknown team member",
        message: "Team member tm-elsewhere was not found in this workspace.",
      },
    ]);
  });

  it("refuses the later row of a team member listed twice", () => {
    const result = validate(
      [
        { role: "BASE", email: "a@school.org", teamMemberId: "tm-1" },
        { role: "BASE", email: "b@school.org", teamMemberId: "tm-1" },
      ],
      { teamMemberIds: ["tm-1"] }
    );

    expect(result.errors).toEqual([
      expect.objectContaining({ row: 3, title: "Duplicate team member" }),
    ]);
  });

  it("refuses an address SSO does not allow inviting", () => {
    const result = validate([{ role: "BASE", email: "Jane@Acme.com" }], {
      ssoRefusals: { "jane@acme.com": "Users are managed by your IdP." },
    });

    expect(result.errors).toEqual([
      { row: 2, title: "SSO", message: "Users are managed by your IdP." },
    ]);
  });

  it("reports every row's problems, not just the first", () => {
    const result = validate([
      { role: "BASE", email: "ok@school.org" },
      { role: "BASE", email: "bad" },
      { role: "OWNER", email: "also-ok@school.org" },
    ]);

    expect(result.errors.map((error) => error.row)).toEqual([3, 4]);
    expect(result.totalErrors).toBe(2);
  });

  it("lists at most the reporting cap but counts every problem", () => {
    const rows = Array.from({ length: MAX_REPORTED_ROW_ERRORS + 5 }, () => ({
      role: "BASE",
      email: "not-an-address",
    }));

    const result = validate(rows);

    expect(result.errors).toHaveLength(MAX_REPORTED_ROW_ERRORS);
    expect(result.totalErrors).toBe(MAX_REPORTED_ROW_ERRORS + 5);
  });

  it("refuses a file over the row cap as a whole", () => {
    const rows = Array.from({ length: MAX_IMPORT_USERS_ROWS + 1 }, (_, i) => ({
      role: "BASE",
      email: `user${i}@school.org`,
    }));

    const result = validate(rows);

    expect(result.errors).toEqual([
      expect.objectContaining({ row: 0, title: "File too large" }),
    ]);
  });
});
