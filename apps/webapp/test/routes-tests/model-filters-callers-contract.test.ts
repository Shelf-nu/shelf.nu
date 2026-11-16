/**
 * Contract test: only hooks that search the server may call
 * `/api/model-filters`.
 *
 * The route caps its search results at `SEARCH_TAKE_LIMIT`. A picker that
 * loads them once and filters them in the browser can never offer a match
 * outside that first set, and nothing on screen says so: workspaces with a
 * few hundred tags, locations or team members simply cannot find some of them.
 *
 * Every caller must send the typed text to the server. The two hooks below do:
 * `useModelFilters` (behind `DynamicSelect` / `DynamicDropdown`) and
 * `useTagSuggestions` (behind the bulk tag dialogs). Use one of them for a new
 * picker. Adding a file to the allowlist needs a reviewer to confirm it
 * searches the server as the user types.
 *
 * @see {@link file://../../app/routes/api+/model-filters.ts} SEARCH_TAKE_LIMIT
 * @see {@link file://../../app/hooks/use-model-filters.ts}
 * @see {@link file://../../app/components/tag/use-tag-suggestions.ts}
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @vitest-environment node

const APP_DIR = path.resolve(__dirname, "../../app");

/** Files allowed to call `/api/model-filters`: each searches it as the user types. */
const SERVER_SEARCHING_CALLERS = new Set<string>([
  "hooks/use-model-filters.ts",
  "components/tag/use-tag-suggestions.ts",
]);

/** The route itself, which names its own path in docs and errors. */
const ROUTE_FILE = "routes/api+/model-filters.ts";

/**
 * A string naming the route in code (quotes or a template literal): how a
 * fetcher, `fetch` or link calls it. Comments are stripped first, so a JSDoc
 * mention of the route does not count as a call.
 */
const CALL_PATTERN = /["'`]\/api\/model-filters\b/;

/** Removes block and line comments, keeping `//` inside URLs (`https://`). */
function stripComments(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Whether this source calls `/api/model-filters`. */
function callsModelFilters(src: string) {
  return CALL_PATTERN.test(stripComments(src));
}

const SOURCE_FILES = readdirSync(APP_DIR, { recursive: true })
  // Forward slashes on every OS, so entries match the allowlist on Windows too.
  .map((entry) => String(entry).split(path.sep).join("/"))
  .filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) && !f.includes(".test.") && !f.includes(".spec.")
  );

const CALLERS = SOURCE_FILES.filter(
  (f) =>
    f !== ROUTE_FILE &&
    callsModelFilters(readFileSync(path.join(APP_DIR, f), "utf8"))
);

describe("/api/model-filters callers contract", () => {
  it("recognises calls, not mentions (sanity)", () => {
    expect(
      callsModelFilters('fetcher.load("/api/model-filters?name=tag")')
    ).toBe(true);
    expect(
      callsModelFilters("fetch(`/api/model-filters?queryValue=${q}`)")
    ).toBe(true);
    expect(
      callsModelFilters("/** Searches `/api/model-filters` as you type. */")
    ).toBe(false);
    expect(callsModelFilters('// see "/api/model-filters"')).toBe(false);
  });

  it("finds the source files and the known callers (sanity)", () => {
    // A scan that matches nothing would make the check below vacuous.
    expect(SOURCE_FILES.length).toBeGreaterThan(0);
    expect(CALLERS).toContain("hooks/use-model-filters.ts");
  });

  it("allowlisted callers still exist and still call the route", () => {
    for (const caller of SERVER_SEARCHING_CALLERS) {
      expect(
        CALLERS,
        `${caller} is allowlisted but no longer calls /api/model-filters`
      ).toContain(caller);
    }
  });

  it("every caller is a server-searching hook", () => {
    const unexpected = CALLERS.filter((f) => !SERVER_SEARCHING_CALLERS.has(f));

    expect(
      unexpected,
      "These files call /api/model-filters directly. The route returns one " +
        "capped page per request, so a picker that loads it once and filters " +
        "in the browser hides every row past that page. Use useModelFilters " +
        "(DynamicSelect / DynamicDropdown) or useTagSuggestions instead."
    ).toEqual([]);
  });
});
