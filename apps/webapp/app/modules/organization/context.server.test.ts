/**
 * Resolving the selected workspace for an SSO user with no workspace at all.
 *
 * SSO users never see their personal workspace, so one with no team workspace
 * has nowhere to land and is sent to the pending-assignment page. That decision
 * needs to know the user is SSO even when they hold no membership to read the
 * flag from.
 *
 * @see {@link file://./context.server.ts}
 * @see {@link file://./service.server.ts} isSsoUser
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";

import { getSelectedOrganization } from "./context.server";
import { getUserOrganizations } from "./service.server";

// @vitest-environment node

// why: the user row is read only when there are no memberships; no database in
// a unit test.
vi.mock("~/database/db.server", () => ({
  db: { user: { findUnique: vi.fn() } },
}));

// why: the membership read is the input these cases vary. `isSsoUser` stays
// real — it is the decision under test.
vi.mock("./service.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service.server")>();
  return { ...actual, getUserOrganizations: vi.fn() };
});

const request = () => new Request("http://localhost/assets");

describe("getSelectedOrganization — no memberships", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserOrganizations).mockResolvedValue([]);
  });

  it("flags an SSO user with no workspace for the pending-assignment page", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ sso: true } as never);

    const result = await getSelectedOrganization({
      userId: "user-1",
      request: request(),
    });

    expect(result.noVisibleOrganizations).toBe(true);
  });

  it("does not flag a password user with no workspace", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ sso: false } as never);

    const result = await getSelectedOrganization({
      userId: "user-1",
      request: request(),
    }).catch((cause: unknown) => ({
      noVisibleOrganizations: undefined,
      cause,
    }));

    expect(result.noVisibleOrganizations).not.toBe(true);
  });
});
