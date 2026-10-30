// @vitest-environment node
/**
 * Link titles in the location activity (notes) loader.
 *
 * The loader reads the page titles for the link chips in the location's notes
 * with one `getLinkTitles` call and returns them as `linkTitles`. These tests
 * pin that it hands over exactly the notes it returns, scoped to the workspace
 * the permission check resolved from the session rather than anything in the
 * URL.
 *
 * @see {@link file://../../../app/routes/_layout+/locations.$locationId.activity.tsx}
 * @see {@link file://../../../app/modules/link-preview/service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

const { getLinkTitles, getLocation, getLocationNotes, requirePermission } =
  vi.hoisted(() => ({
    getLinkTitles: vi.fn(),
    getLocation: vi.fn(),
    getLocationNotes: vi.fn(),
    requirePermission: vi.fn(),
  }));

// why: the permission check is where the workspace comes from; stubbing it
// lets the test hand back a session workspace that differs from the URL.
vi.mock("~/utils/roles.server", () => ({ requirePermission }));

// why: DB reads. The test controls the notes the loader receives.
vi.mock("~/modules/location/service.server", () => ({ getLocation }));
vi.mock("~/modules/location-note/service.server", () => ({
  getLocationNotes,
}));

// why: reads stored titles from the DB and fetches pages over the network. The
// test pins what the loader hands it and what it does with the answer.
vi.mock("~/modules/link-preview/service.server", () => ({ getLinkTitles }));

import { loader } from "~/routes/_layout+/locations.$locationId.activity";

describe("location activity loader: link titles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({
      organizationId: "org-from-session",
      userOrganizations: [],
    });
    getLocation.mockResolvedValue({
      location: { id: "location-1", name: "Warehouse" },
    });
  });

  it("reads the titles of the links in the location's notes once, for the session's workspace", async () => {
    const notes = [
      {
        id: "note-1",
        type: "COMMENT",
        content: "Floor plan: https://example.com/m.pdf",
      },
      { id: "note-2", type: "UPDATE", content: "Location renamed" },
    ];
    getLocationNotes.mockResolvedValue(notes);
    const linkTitles = {
      "https://example.com/m.pdf": { pageTitle: "Manual", customTitle: null },
    };
    getLinkTitles.mockResolvedValue(linkTitles);

    const response = (await loader(
      createLoaderArgs({
        request: new Request("http://localhost/locations/location-1/activity"),
        params: { locationId: "location-1" },
        context: { getSession: () => ({ userId: "user-1" }) } as never,
      })
    )) as unknown as { notes: unknown[]; linkTitles: unknown };

    expect(getLinkTitles).toHaveBeenCalledTimes(1);
    expect(getLinkTitles).toHaveBeenCalledWith({
      organizationId: "org-from-session",
      notes,
    });
    // The very notes the page shows, not a copy or a subset.
    expect(getLinkTitles.mock.calls[0][0].notes).toBe(response.notes);
    expect(response.linkTitles).toEqual(linkTitles);
  });
});
