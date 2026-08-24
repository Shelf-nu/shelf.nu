import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @vitest-environment node

/**
 * Contract test: every route that serves a `.csv` download must build its
 * response with `csvResponse`.
 *
 * Spreadsheet applications pick a CSV's encoding from its first bytes, so a
 * download without the UTF-8 byte order mark opens as mojibake for any
 * non-Latin content. `csvResponse` (`~/utils/csv-utf8`) is the one place that
 * adds the mark and sets `charset=utf-8`; a route that hand-rolls its
 * `Response` ships the bug again for its own export only, which is invisible
 * to every other test.
 *
 * @see {@link file://../../app/utils/csv-utf8.ts}
 */
const ROUTES_DIR = path.resolve(__dirname, "../../app/routes");

/**
 * Routes that serve a `.csv` path but deliberately do not go through
 * `csvResponse`. Deliberately empty — an entry here means a download users
 * open in a spreadsheet is exempt from the encoding guarantee, so it needs a
 * stated reason and a reviewer, not a quiet addition.
 */
const CSV_RESPONSE_EXEMPT = new Set<string>([]);

/**
 * Every CSV route file, at any depth and either extension.
 *
 * Matched on the `[.csv]` filename segment, which is how remix-flat-routes
 * spells a literal `.csv` in a URL, rather than on a directory: these routes
 * live under both `_layout+/` and `api+/`, and the next one may live somewhere
 * else again. Recursive and `.tsx`-inclusive so a route cannot escape the
 * contract by its location or extension.
 */
const CSV_ROUTE_FILES = readdirSync(ROUTES_DIR, { recursive: true })
  .map((entry) => String(entry))
  .filter(
    (f) =>
      /\[\.csv\]\.(ts|tsx)$/.test(f) &&
      !f.includes(".test.") &&
      !f.includes(".spec.")
  );

const GUARDED_FILES = CSV_ROUTE_FILES.filter(
  (f) => !CSV_RESPONSE_EXEMPT.has(f)
);

describe("csv download encoding contract", () => {
  it("finds the CSV routes (sanity)", () => {
    // A glob that silently matches nothing would make every assertion below
    // vacuous, and the suite would stay green with the contract unenforced.
    expect(CSV_ROUTE_FILES.length).toBeGreaterThan(0);
  });

  it("exempt routes still exist (catch stale exemptions)", () => {
    for (const exempt of CSV_RESPONSE_EXEMPT) {
      expect(
        CSV_ROUTE_FILES,
        `${exempt} is exempt but no longer exists`
      ).toContain(exempt);
    }
  });

  it.each(GUARDED_FILES)("%s builds its response with csvResponse", (file) => {
    const src = readFileSync(path.join(ROUTES_DIR, file), "utf8");

    expect(src, `${file} should import from ~/utils/csv-utf8`).toMatch(
      /from ["']~\/utils\/csv-utf8["']/
    );
    expect(src, `${file} should return csvResponse(...)`).toMatch(
      /\bcsvResponse\s*\(/
    );
    expect(
      src,
      `${file} should not hand-roll a text/csv Response — csvResponse sets the content type`
    ).not.toMatch(/["']text\/csv["']/);
  });
});
