/**
 * Tests for the Advanced-mode filter normalizer.
 *
 * Regression coverage for the report drill-down bug where bare column-filter
 * values (e.g. `?location=<uuid>`, emitted by the Asset Distribution donut)
 * were silently dropped instead of normalized to operator form (`is:<uuid>`),
 * making drill-down a no-op for any workspace in Advanced mode.
 *
 * @see {@link file://./cookies.server.ts}
 */
import type { AssetIndexSettings } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

// why: cookies.server pulls in modules whose transitive imports try to
// initialize the Prisma client at import time, which throws when no DB is
// reachable. The function under test never touches the DB.
vi.mock("~/database/db.server", () => ({ db: {} }));

import { getAdvancedFiltersFromRequest } from "./cookies.server";

const ORG_ID = "org-test";

/** Minimal settings stub with the column names exercised by the tests. */
const settings = {
  columns: [
    { name: "location", visible: true, position: 0 },
    { name: "category", visible: true, position: 1 },
    { name: "status", visible: true, position: 2 },
  ],
} as unknown as AssetIndexSettings;

const makeRequest = (query: string) =>
  new Request(`https://app.example.com/assets${query}`);

describe("getAdvancedFiltersFromRequest", () => {
  it("normalizes a bare column value to `is:<value>` and signals redirect", async () => {
    const result = await getAdvancedFiltersFromRequest(
      makeRequest("?location=loc-uuid"),
      ORG_ID,
      settings
    );

    expect(result.filters).toBe("location=is%3Aloc-uuid");
    expect(result.redirectNeeded).toBe(true);
    expect(result.serializedCookie).toBeDefined();
  });

  it("normalizes multiple bare column values (location, category, status)", async () => {
    const result = await getAdvancedFiltersFromRequest(
      makeRequest("?location=loc-1&category=cat-1&status=AVAILABLE"),
      ORG_ID,
      settings
    );

    const params = new URLSearchParams(result.filters);
    expect(params.get("location")).toBe("is:loc-1");
    expect(params.get("category")).toBe("is:cat-1");
    expect(params.get("status")).toBe("is:AVAILABLE");
    expect(result.redirectNeeded).toBe(true);
  });

  it("passes operator-prefixed values through unchanged", async () => {
    const result = await getAdvancedFiltersFromRequest(
      makeRequest("?status=is%3AAVAILABLE"),
      ORG_ID,
      settings
    );

    expect(result.filters).toBe("status=is%3AAVAILABLE");
    expect(result.redirectNeeded).toBe(false);
  });

  it("leaves non-column params (page, search) untouched", async () => {
    const result = await getAdvancedFiltersFromRequest(
      makeRequest("?page=2&s=keyboard&location=loc-uuid"),
      ORG_ID,
      settings
    );

    const params = new URLSearchParams(result.filters);
    expect(params.get("page")).toBe("2");
    expect(params.get("s")).toBe("keyboard");
    expect(params.get("location")).toBe("is:loc-uuid");
  });

  it("drops empty column values cleanly without producing `is:` (URL gets cleaned via redirect)", async () => {
    const result = await getAdvancedFiltersFromRequest(
      makeRequest("?location="),
      ORG_ID,
      settings
    );

    // The empty value is not echoed back as `is:` and not retained. The
    // redirect fires so the browser URL no longer carries the empty filter.
    expect(result.filters).toBe("");
    expect(result.redirectNeeded).toBe(true);
  });

  it("returns empty state when no URL params and no cookie", async () => {
    const result = await getAdvancedFiltersFromRequest(
      makeRequest(""),
      ORG_ID,
      settings
    );

    expect(result.filters).toBe("");
    expect(result.redirectNeeded).toBe(false);
    expect(result.serializedCookie).toBeUndefined();
  });
});
