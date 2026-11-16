/**
 * Tests for {@link assetsEmptyStateContent}: the asset index offers the
 * spreadsheet import in its zero-data state only to members who may import,
 * and never in the Archived view.
 *
 * @see {@link file://./assets-empty-state.ts}
 */
import { describe, expect, it } from "vitest";

import { assetsEmptyStateContent } from "./assets-empty-state";

describe("assetsEmptyStateContent", () => {
  it("offers the import beside 'Create your first asset' when the member may import", () => {
    const content = assetsEmptyStateContent({
      archivedView: null,
      canImportAssets: true,
    });

    expect(content.newButtonRoute).toBe("/assets/new");
    expect(content.secondaryButton).toEqual({
      route: "/assets/import",
      content: "Import a spreadsheet",
    });
  });

  it("leaves the import out when the member may not import", () => {
    const content = assetsEmptyStateContent({
      archivedView: null,
      canImportAssets: false,
    });

    expect(content.newButtonRoute).toBe("/assets/new");
    expect(content.secondaryButton).toBeUndefined();
  });

  it("offers no buttons in the Archived view, even to a member who may import", () => {
    const content = assetsEmptyStateContent({
      archivedView: "archived",
      canImportAssets: true,
    });

    expect(content.title).toBe("Nothing archived");
    expect(content.newButtonRoute).toBeUndefined();
    expect(content.secondaryButton).toBeUndefined();
  });
});
