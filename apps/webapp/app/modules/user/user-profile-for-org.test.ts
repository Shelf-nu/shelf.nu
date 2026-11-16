/**
 * The team profile page's user read: an explicit select of what the page
 * renders, no cross-workspace memberships, no invite internals, and no write.
 *
 * @see {@link file://./service.server.ts} getUserProfileForOrg
 * @see {@link file://../user-contact/service.server.ts} getUserContactForDisplay
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";

// why: the query shape is the behaviour under test
vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findFirstOrThrow: vi.fn(() =>
        Promise.resolve({
          id: "target",
          userOrganizations: [{ organizationId: "org-1", roles: ["BASE"] }],
        })
      ),
    },
    userContact: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      upsert: vi.fn(),
    },
  },
}));

const { getUserProfileForOrg } = await import("~/modules/user/service.server");
const { getUserContactForDisplay } = await import(
  "~/modules/user-contact/service.server"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserProfileForOrg", () => {
  it("selects explicit fields scoped to the viewer's workspaces", async () => {
    await getUserProfileForOrg({
      id: "target",
      organizationId: "org-1",
      userOrganizations: [{ organizationId: "org-1" }],
    });

    const [{ select }] = vi.mocked(db.user.findFirstOrThrow).mock
      .calls[0] as unknown as [{ select: Record<string, unknown> }];
    expect(select).not.toHaveProperty("customerId");
    expect(select).not.toHaveProperty("tierId");
    expect(select.userOrganizations).toEqual({
      where: { organizationId: { in: ["org-1"] } },
      select: { organizationId: true, roles: true },
    });
    expect(select.teamMembers).toEqual({
      where: { organizationId: "org-1" },
      select: {
        id: true,
        receivedInvites: {
          where: { organizationId: "org-1" },
          select: { status: true },
        },
      },
    });
  });

  it("offers a workspace switch when the user is only in another of the viewer's workspaces", async () => {
    vi.mocked(db.user.findFirstOrThrow).mockResolvedValueOnce({
      id: "target",
      userOrganizations: [{ organizationId: "org-2", roles: ["BASE"] }],
    } as never);

    await expect(
      getUserProfileForOrg({
        id: "target",
        organizationId: "org-1",
        userOrganizations: [
          { organizationId: "org-1" },
          { organizationId: "org-2" },
        ],
      })
    ).rejects.toMatchObject({
      status: 404,
      additionalData: {
        model: "teamMember",
        organizations: [{ organizationId: "org-2" }],
      },
    });
  });
});

describe("getUserContactForDisplay", () => {
  it("reads without creating a row", async () => {
    const contact = await getUserContactForDisplay("target");

    expect(db.userContact.upsert).not.toHaveBeenCalled();
    expect(contact).toEqual({
      phone: null,
      street: null,
      city: null,
      stateProvince: null,
      zipPostalCode: null,
      countryRegion: null,
    });
  });
});
