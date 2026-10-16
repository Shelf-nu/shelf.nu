/**
 * Users import pre-flight
 *
 * Validates every row of an uploaded users CSV before `bulkInviteUsers` writes
 * anything, so a file is either imported whole or refused whole with a list of
 * what to fix, the same contract as the asset import.
 *
 * Pure and synchronous: the few facts that need the database (which team
 * members exist in the workspace, which addresses SSO refuses) are looked up
 * once for the whole file by the caller and passed in, so validation costs a
 * fixed number of queries however many rows there are.
 *
 * @see {@link file://./service.server.ts} `bulkInviteUsers`
 * @see {@link file://./../asset/import-preflight.server.ts} the asset twin
 */
import {
  MAX_REPORTED_ROW_ERRORS,
  spreadsheetRowNumber,
  type ImportPreflightResult,
  type ImportRowError,
} from "~/utils/import-row-errors";
import { validEmail } from "~/utils/misc";
import { normalizeInviteEmail } from "./helpers";
import {
  INVITABLE_ROLES,
  parseInvitableRole,
  type InvitableRole,
} from "./roles";

/** The largest users file accepted, in data rows. Each row sends an email. */
export const MAX_IMPORT_USERS_ROWS = 1000;

/** One data row of the users CSV, as the parser hands it over. */
export type ImportUserCsvRow = {
  role?: string | null;
  email?: string | null;
  teamMemberId?: string | null;
};

/** A row that passed every check, ready to be invited. */
export type ValidImportUserRow = {
  /** The spreadsheet row it came from. */
  row: number;
  /** The address, normalized the way every invite lookup compares it. */
  email: string;
  role: InvitableRole;
  /** The existing team member to invite, or null to create one. */
  teamMemberId: string | null;
  /**
   * The name a newly created team member gets: the part of the address before
   * the `@`, as typed. It becomes the first name of the account created when
   * the invite is accepted.
   */
  name: string;
};

/** Arguments for {@link validateImportUserRows}. */
type ValidateImportUserRowsArgs = {
  rows: ImportUserCsvRow[];
  /** Ids of the team members that exist in the importing workspace. */
  workspaceTeamMemberIds: ReadonlySet<string>;
  /** Normalized address to the reason SSO refuses inviting it. */
  ssoRefusalByEmail: ReadonlyMap<string, string>;
};

/** Reads a CSV cell as a trimmed string; a missing cell reads as blank. */
function cell(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Checks every row of a users CSV and reports every problem found.
 *
 * A row is refused when its role cannot be granted by invite, its email is
 * missing or not an address, its email or team member already appears on an
 * earlier row, its team member does not exist in this workspace, or SSO
 * forbids inviting the address. An earlier row wins a duplicate, so the error
 * lands on the later one and names the first.
 *
 * Rows that are valid but need no invite (the person is already a member or
 * already invited) are not errors; the caller skips and reports them.
 *
 * @param args - The rows, and the workspace facts looked up once for the file
 * @returns The problems found (truncated), how many there were, and the rows
 *   that passed. `validRows` is only meaningful when there are no errors.
 */
export function validateImportUserRows({
  rows,
  workspaceTeamMemberIds,
  ssoRefusalByEmail,
}: ValidateImportUserRowsArgs): ImportPreflightResult & {
  validRows: ValidImportUserRow[];
} {
  if (rows.length > MAX_IMPORT_USERS_ROWS) {
    return {
      errors: [
        {
          row: 0,
          title: "File too large",
          message: `The file has ${rows.length} rows. Import at most ${MAX_IMPORT_USERS_ROWS} users at a time.`,
        },
      ],
      totalErrors: 1,
      validRows: [],
    };
  }

  const errors: ImportRowError[] = [];
  const validRows: ValidImportUserRow[] = [];
  const firstRowByEmail = new Map<string, number>();
  const firstRowByTeamMemberId = new Map<string, number>();

  for (const [index, csvRow] of rows.entries()) {
    const row = spreadsheetRowNumber(index);
    const errorCountBefore = errors.length;
    const report = (title: string, message: string) =>
      errors.push({ row, title, message });

    const rawRole = cell(csvRow.role);
    const role = parseInvitableRole(rawRole);
    if (!rawRole) {
      report("Missing role", "Role is required.");
    } else if (!role) {
      report(
        "Invalid role",
        `"${rawRole}" can't be granted by invite. Use one of ${INVITABLE_ROLES.join(
          ", "
        )}. Ownership moves only through ownership transfer.`
      );
    }

    const rawEmail = cell(csvRow.email);
    const email = normalizeInviteEmail(rawEmail);
    if (!rawEmail) {
      report("Missing email", "Email is required.");
    } else if (!validEmail(email)) {
      report("Invalid email", `"${rawEmail}" is not a valid email address.`);
    } else {
      const firstRow = firstRowByEmail.get(email);
      if (firstRow !== undefined) {
        report(
          "Duplicate email",
          `${email} is already on row ${firstRow}. Each person can be invited once.`
        );
      } else {
        firstRowByEmail.set(email, row);
      }

      const ssoRefusal = ssoRefusalByEmail.get(email);
      if (ssoRefusal) {
        report("SSO", ssoRefusal);
      }
    }

    const teamMemberId = cell(csvRow.teamMemberId);
    if (teamMemberId) {
      if (!workspaceTeamMemberIds.has(teamMemberId)) {
        report(
          "Unknown team member",
          `Team member ${teamMemberId} was not found in this workspace.`
        );
      } else {
        const firstRow = firstRowByTeamMemberId.get(teamMemberId);
        if (firstRow !== undefined) {
          report(
            "Duplicate team member",
            `Team member ${teamMemberId} is already on row ${firstRow}. Each team member can be invited once.`
          );
        } else {
          firstRowByTeamMemberId.set(teamMemberId, row);
        }
      }
    }

    if (errors.length === errorCountBefore) {
      validRows.push({
        row,
        email,
        role: role as InvitableRole,
        teamMemberId: teamMemberId || null,
        name: rawEmail.split("@")[0],
      });
    }
  }

  return {
    errors: errors.slice(0, MAX_REPORTED_ROW_ERRORS),
    totalErrors: errors.length,
    validRows,
  };
}
