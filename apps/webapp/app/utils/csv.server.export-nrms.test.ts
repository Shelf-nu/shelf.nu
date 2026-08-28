import { InviteStatuses } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SELECTED_KEY } from "~/utils/list";

const dbMocks = vi.hoisted(() => ({ findMany: vi.fn() }));

// why: the query scope IS the behaviour under test — assert on the `where`
// Prisma receives rather than standing up a database.
vi.mock("~/database/db.server", () => ({
  db: { teamMember: { findMany: dbMocks.findMany } },
}));
// why: suppress lottie animation initialization during module imports
vi.mock("lottie-react", () => ({ default: () => null }));

const { exportNRMsToCsv } = await import("~/utils/csv.server");

const ORG = "org-1";

const NRM_BASE_SCOPE = {
  deletedAt: null,
  organizationId: ORG,
  userId: null,
  receivedInvites: { none: { status: InviteStatuses.PENDING } },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.findMany.mockResolvedValue([]);
});

describe("exportNRMsToCsv", () => {
  it("excludes deleted members and registered users on select-all", async () => {
    await exportNRMsToCsv({ nrmIds: [ALL_SELECTED_KEY], organizationId: ORG });

    // The reported bug: a ~2k-row index exported ~5k rows because this branch
    // selected every TeamMember in the org.
    expect(dbMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: NRM_BASE_SCOPE })
    );
  });

  it("honours the index's active search on select-all", async () => {
    await exportNRMsToCsv({
      nrmIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      search: "john",
    });

    const { where } = dbMocks.findMany.mock.calls[0][0];
    // The NRM's own name plus the three name columns on a linked user
    // (first, last, display) — see `getNrmIndexWhere`.
    expect(where.OR).toHaveLength(4);
  });

  it("keeps explicit ids scoped to live NRMs", async () => {
    await exportNRMsToCsv({ nrmIds: ["a", "b"], organizationId: ORG });

    expect(dbMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...NRM_BASE_SCOPE, id: { in: ["a", "b"] } },
      })
    );
  });
});
