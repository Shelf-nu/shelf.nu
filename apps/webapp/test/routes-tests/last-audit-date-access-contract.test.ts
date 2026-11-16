/**
 * Contract test: every route that hands `lastAuditDateAccess` to a bulk
 * selection derives it on the server from the caller's role access and the
 * workspace's audits add-on, never from a literal.
 *
 * The parameter is required, so the compiler forces every caller to pass one,
 * but any of the three levels type-checks. A route that passed `"available"`
 * would let a caller who may not see audit dates run "select all" filtered by
 * them, and a route that passed `"hidden"` would refuse every select-all that
 * carries the filter, for admins too. Neither shows up in another test: the
 * gate itself is tested once, in the bulk helper, against whatever level it is
 * handed.
 *
 * Web routes resolve the level with `lastAuditDateAccessFor(access,
 * currentOrganization)`. Mobile routes have no organization row, only the
 * mobile context's flags, so they call `resolveLastAuditDateAccess` with
 * `access.audits.seeAll` and `canUseAudits`.
 *
 * @see {@link file://../../app/modules/asset/last-audit-date-access.server.ts}
 * @see {@link file://../../app/modules/asset/bulk-operations-helper.server.ts}
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @vitest-environment node

const ROUTES_DIR = path.resolve(__dirname, "../../app/routes");

/** Every route file, at any depth and either extension. */
const ROUTE_FILES = readdirSync(ROUTES_DIR, { recursive: true })
  .map((entry) => String(entry))
  .filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) && !f.includes(".test.") && !f.includes(".spec.")
  );

/** Each `lastAuditDateAccess: <value>` argument in a route, with its value. */
const ASSIGNMENTS = ROUTE_FILES.flatMap((file) => {
  const source = readFileSync(path.join(ROUTES_DIR, file), "utf8");
  return [...source.matchAll(/lastAuditDateAccess:\s*([^,\n]+)/g)].map(
    (match) => ({
      file,
      value: match[1].trim(),
      index: match.index ?? 0,
      source,
    })
  );
});

/** The web resolution: role access plus the session's organization row. */
const WEB_VALUE = "lastAuditDateAccessFor(";
/** The mobile resolution: role access plus the mobile context's add-on flag. */
const MOBILE_VALUE = "resolveLastAuditDateAccess({";

describe("lastAuditDateAccess in routes", () => {
  it("is passed by the bulk routes", () => {
    // A floor, not an exact count: new callers are welcome, and every one of
    // them is checked below. Dropping well under it means the matcher broke.
    expect(ASSIGNMENTS.length).toBeGreaterThanOrEqual(19);
  });

  it.each(ASSIGNMENTS.map((a) => [a.file, a]))(
    "%s resolves the level on the server",
    (_file, assignment) => {
      const { value, file, source, index } =
        assignment as (typeof ASSIGNMENTS)[number];
      expect(
        value.startsWith(WEB_VALUE) || value.startsWith(MOBILE_VALUE)
      ).toBe(true);

      if (value.startsWith(WEB_VALUE)) {
        const call = source.slice(index, index + 200).replace(/\s+/g, "");
        expect(call).toContain(
          "lastAuditDateAccessFor(access,currentOrganization)"
        );
      } else {
        expect(file).toMatch(/mobile\+/);
        const call = source.slice(index, index + 200).replace(/\s+/g, "");
        expect(call).toContain("seeAllAudits:access.audits.seeAll");
        expect(call).toContain("auditsUsable:canUseAudits");
      }
    }
  );
});
