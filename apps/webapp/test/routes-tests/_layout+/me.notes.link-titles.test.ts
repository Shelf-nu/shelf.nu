// @vitest-environment node
/**
 * Link titles in the "my notes" loader (`/me/notes`).
 *
 * The loader reads the page titles for the link chips in the caller's team
 * member notes with one `getLinkTitles` call and returns them as
 * `linkTitles`. These tests pin that it hands over exactly the notes it
 * returns, scoped to the workspace the permission check resolved from the
 * session.
 *
 * @see {@link file://../../../app/routes/_layout+/me.notes.tsx}
 * @see {@link file://../../../app/modules/link-preview/service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

const { findFirst, getLinkTitles, getTeamMemberNotes, requirePermission } =
  vi.hoisted(() => ({
    findFirst: vi.fn(),
    getLinkTitles: vi.fn(),
    getTeamMemberNotes: vi.fn(),
    requirePermission: vi.fn(),
  }));

// why: the permission check is where the workspace comes from; stubbing it
// lets the test hand back a session workspace of its choosing.
vi.mock("~/utils/roles.server", () => ({ requirePermission }));

// why: the loader resolves the caller's team member with one DB read.
vi.mock("~/database/db.server", () => ({
  db: { teamMember: { findFirst } },
}));

// why: DB read. The test controls the notes the loader receives.
vi.mock("~/modules/team-member-note/service.server", () => ({
  getTeamMemberNotes,
}));

// why: reads stored titles from the DB and fetches pages over the network. The
// test pins what the loader hands it and what it does with the answer.
vi.mock("~/modules/link-preview/service.server", () => ({ getLinkTitles }));

import { loader } from "~/routes/_layout+/me.notes";

describe("my notes loader: link titles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({
      organizationId: "org-from-session",
    });
    findFirst.mockResolvedValue({ id: "team-member-1" });
  });

  it("reads the titles of the links in the caller's notes once, for the session's workspace", async () => {
    const notes = [
      {
        id: "note-1",
        type: "COMMENT",
        content: "Training: https://example.com/m.pdf",
      },
      { id: "note-2", type: "UPDATE", content: "Role changed to Admin" },
    ];
    getTeamMemberNotes.mockResolvedValue(notes);
    const linkTitles = {
      "https://example.com/m.pdf": { pageTitle: "Manual", customTitle: null },
    };
    getLinkTitles.mockResolvedValue(linkTitles);

    const response = (await loader(
      createLoaderArgs({
        request: new Request("http://localhost/me/notes"),
        context: { getSession: () => ({ userId: "user-1" }) } as never,
      })
    )) as unknown as { notes: unknown[]; linkTitles: unknown };

    // The team member is looked up in the session's workspace too.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-from-session" }),
      })
    );
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
