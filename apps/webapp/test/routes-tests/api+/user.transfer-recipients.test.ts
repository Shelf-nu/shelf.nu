/**
 * Transfer recipients: the candidates offered in the change-role dialog are
 * the roles whose policy may receive transfers, and the owner flag comes from
 * the whole membership.
 *
 * @see {@link file://./../../../app/routes/api+/user.transfer-recipients.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { loader } from "~/routes/api+/user.transfer-recipients";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: authorization is resolved upstream; the query shape is under test
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the candidate query is the contract; its rows are supplied directly
vi.mock("~/database/db.server", () => ({
  db: { userOrganization: { findMany: vi.fn() } },
}));

describe("user.transfer-recipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);
  });

  it("filters candidates by the receive-transfers policy and flags owners", async () => {
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([
      {
        roles: ["ADMIN", "OWNER"],
        user: {
          id: "u-1",
          firstName: "A",
          lastName: "B",
          displayName: null,
          email: "a@x.io",
        },
      },
    ] as unknown as Awaited<ReturnType<typeof db.userOrganization.findMany>>);

    const response = (await loader({
      context: { getSession: () => ({ userId: "admin-1" }) },
      request: new Request(
        "http://localhost/api/user/transfer-recipients?excludeUserId=t-1"
      ),
      params: {},
    } as unknown as LoaderFunctionArgs)) as unknown as {
      data: { isOwner: boolean }[];
    };

    expect(db.userOrganization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { not: "t-1" },
          roles: { hasSome: ["OWNER", "ADMIN"] },
        }),
      })
    );
    expect(response.data[0].isOwner).toBe(true);
  });
});
