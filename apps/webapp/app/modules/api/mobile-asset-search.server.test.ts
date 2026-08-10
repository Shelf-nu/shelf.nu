/**
 * Test suite for the mobile assets-list search fragment.
 *
 * Pins which fields the companion's asset search matches — title, SAM id
 * (sequentialId), description, category name, tag names — so the mobile API
 * can't silently drift back to title-only search (users trained on the web
 * search read a zero-result list as "search is broken") and can't silently
 * grow the heavy web branches (custodian traversal, custom-fields JSON) that
 * are deliberately excluded on mobile. Pure module — no mocks needed.
 *
 * @see {@link file://./mobile-asset-search.server.ts}
 */
import { buildMobileAssetSearchWhere } from "./mobile-asset-search.server";

// @vitest-environment node

describe("buildMobileAssetSearchWhere", () => {
  it("returns an empty fragment when search is empty", () => {
    expect(buildMobileAssetSearchWhere("")).toEqual({});
  });

  it("matches title, sequentialId, description, category and tags", () => {
    const contains = { contains: "tripod", mode: "insensitive" };

    expect(buildMobileAssetSearchWhere("tripod")).toEqual({
      OR: [
        { title: contains },
        { sequentialId: contains },
        { description: contains },
        { category: { name: contains } },
        { tags: { some: { name: contains } } },
      ],
    });
  });

  it("matches every field case-insensitively", () => {
    const { OR } = buildMobileAssetSearchWhere("SAM-0001");

    const modes = (OR ?? []).map(
      (branch) =>
        JSON.stringify(branch).match(/"mode":"(\w+)"/)?.[1] ?? "MISSING"
    );

    expect(modes).toEqual(Array(5).fill("insensitive"));
  });

  it("does not traverse custody, custom fields, locations or codes", () => {
    const fragment = JSON.stringify(buildMobileAssetSearchWhere("term"));

    for (const heavyBranch of [
      "custody",
      "customFields",
      "assetLocations",
      "qrCodes",
      "barcodes",
    ]) {
      expect(fragment).not.toContain(heavyBranch);
    }
  });
});
