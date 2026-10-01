/**
 * The shared quantity-custody functions, used by the single-asset quantity
 * routes and the bulk custody routes on web and mobile alike.
 *
 * Pinned here once rather than per route: the split of a bulk submission, the
 * pre-flight checks that keep a refused submission from writing anything, and
 * the audit note plus low-stock check that follow every unit change.
 *
 * @see {@link file://./quantity-custody.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeCustodyAvailability } from "~/modules/asset/availability-primitives.server";
import {
  checkOutQuantity,
  releaseQuantity,
} from "~/modules/asset/service.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { createNote } from "~/modules/note/service.server";
import {
  assertAssignableQuantities,
  assignQuantityToCustodian,
  releaseQuantityFromCustodian,
  resolveQuantityReleases,
  splitQuantityAssetIds,
  type QuantityCustodian,
} from "./quantity-custody.server";

// why: the pre-flight and holder lookup read assets and custody rows; these
// tests are about what the functions decide from those rows
const dbMocks = vi.hoisted(() => ({
  assetFindFirst: vi.fn(),
  custodyFindMany: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findFirst: dbMocks.assetFindFirst },
    custody: { findMany: dbMocks.custodyFindMany },
  },
}));

// why: the free-unit count has its own suite in the availability leaf
vi.mock("~/modules/asset/availability-primitives.server", () => ({
  computeCustodyAvailability: vi.fn(),
}));

// why: the custody writes are the services' job and have their own suites;
// here they only need to succeed or refuse
vi.mock("~/modules/asset/service.server", () => ({
  checkOutQuantity: vi.fn().mockResolvedValue({}),
  releaseQuantity: vi.fn().mockResolvedValue({ consumed: 0, returned: 3 }),
}));

// why: notes are written to the database; the content is what is asserted
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(),
}));

// why: the acting user's name, without a database
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: null,
  }),
}));

// why: the notifier sends email; whether it runs is what is asserted
vi.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vi.fn(),
}));

// why: best-effort failures are logged; keep the test output quiet
vi.mock("~/utils/logger", () => ({ Logger: { error: vi.fn() } }));

const ACTOR =
  '{% link to="/settings/team/users/user-1" text="Ada Lovelace" /%}';

const custodian: QuantityCustodian = {
  id: "tm-1",
  name: "Jane Doe",
  user: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("splitQuantityAssetIds", () => {
  it("separates assets named in quantities from whole assets", () => {
    expect(
      splitQuantityAssetIds(["a", "q1", "b", "q2"], { q1: 3, q2: 1 })
    ).toEqual({ quantityAssetIds: ["q1", "q2"], bulkAssetIds: ["a", "b"] });
  });

  it("collapses an asset scanned under two codes", () => {
    expect(splitQuantityAssetIds(["q1", "a", "q1", "a"], { q1: 2 })).toEqual({
      quantityAssetIds: ["q1"],
      bulkAssetIds: ["a"],
    });
  });

  it("ignores quantities for assets that were not submitted", () => {
    expect(splitQuantityAssetIds(["a"], { other: 4 })).toEqual({
      quantityAssetIds: [],
      bulkAssetIds: ["a"],
    });
  });
});

describe("assertAssignableQuantities", () => {
  function freeUnits(free: Record<string, number>) {
    dbMocks.assetFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id in free ? { title: `Asset ${where.id}`, quantity: 50 } : null
        )
    );
    vi.mocked(computeCustodyAvailability).mockImplementation(
      (_db, { assetId }) =>
        Promise.resolve({
          inCustody: 0,
          inKits: 0,
          checkedOut: 0,
          available: free[assetId],
        })
    );
  }

  it("passes when every asset asks for at most its free units", async () => {
    freeUnits({ q1: 5, q2: 1 });
    await expect(
      assertAssignableQuantities({
        quantityAssetIds: ["q1", "q2"],
        quantities: { q1: 5, q2: 1 },
        organizationId: "org-1",
      })
    ).resolves.toBeUndefined();
  });

  it("refuses once, naming every asset that asks for too much", async () => {
    freeUnits({ q1: 5, q2: 1, q3: 9 });
    await expect(
      assertAssignableQuantities({
        quantityAssetIds: ["q1", "q2", "q3"],
        quantities: { q1: 6, q2: 1, q3: 10 },
        organizationId: "org-1",
      })
    ).rejects.toMatchObject({
      status: 400,
      message:
        'Nothing was assigned. "Asset q1" (asked for 6, 5 free); "Asset q3" (asked for 10, 9 free).',
    });
  });

  it("leaves an asset outside the workspace to checkOutQuantity", async () => {
    freeUnits({});
    await expect(
      assertAssignableQuantities({
        quantityAssetIds: ["elsewhere"],
        quantities: { elsewhere: 1 },
        organizationId: "org-1",
      })
    ).resolves.toBeUndefined();
    expect(computeCustodyAvailability).not.toHaveBeenCalled();
  });
});

describe("resolveQuantityReleases", () => {
  function row(assetId: string, teamMemberId: string, quantity: number) {
    return {
      assetId,
      quantity,
      asset: { title: `Asset ${assetId}` },
      custodian: { id: teamMemberId, name: teamMemberId, user: null },
    };
  }

  it("needs no lookup when nothing is released by units", async () => {
    await expect(
      resolveQuantityReleases({
        quantityAssetIds: [],
        quantities: {},
        organizationId: "org-1",
      })
    ).resolves.toEqual([]);
    expect(dbMocks.custodyFindMany).not.toHaveBeenCalled();
  });

  it("resolves each asset to its single operator holder", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([row("q1", "tm-1", 8)]);

    const resolved = await resolveQuantityReleases({
      quantityAssetIds: ["q1"],
      quantities: { q1: 8 },
      organizationId: "org-1",
    });

    expect(resolved).toEqual([
      { assetId: "q1", custodian: { id: "tm-1", name: "tm-1", user: null } },
    ]);
    expect(dbMocks.custodyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetId: { in: ["q1"] },
          kitCustodyId: null,
          asset: { organizationId: "org-1" },
        },
      })
    );
  });

  it.each([
    [
      "nobody holds units",
      [],
      "This asset has no units in anyone's custody to release.",
    ],
    [
      "two people hold units",
      [row("q1", "tm-1", 2), row("q1", "tm-2", 3)],
      '"Asset q1" is held by more than one person. Release it from the asset\'s custody list, where each holder is listed separately.',
    ],
    [
      "the holder has fewer units than asked",
      [row("q1", "tm-1", 2)],
      'Nothing was released. "Asset q1" has only 2 unit(s) in custody.',
    ],
  ])("refuses when %s", async (_label, rows, message) => {
    dbMocks.custodyFindMany.mockResolvedValue(rows);
    await expect(
      resolveQuantityReleases({
        quantityAssetIds: ["q1"],
        quantities: { q1: 3 },
        organizationId: "org-1",
      })
    ).rejects.toMatchObject({ status: 400, message });
  });
});

describe("assignQuantityToCustodian", () => {
  const args = {
    assetId: "q1",
    custodian,
    quantity: 3,
    userId: "user-1",
    organizationId: "org-1",
    role: OrganizationRoles.ADMIN,
  };

  it("assigns, writes one audit note, and runs the low-stock check", async () => {
    await assignQuantityToCustodian(args);

    expect(checkOutQuantity).toHaveBeenCalledWith({
      assetId: "q1",
      teamMemberId: "tm-1",
      quantity: 3,
      userId: "user-1",
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      note: undefined,
    });
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(createNote).toHaveBeenCalledWith({
      content: `${ACTOR} assigned **3** unit(s) to **Jane Doe**.`,
      type: "UPDATE",
      userId: "user-1",
      assetId: "q1",
      organizationId: "org-1",
    });
    expect(checkAndNotifyLowStock).toHaveBeenCalledTimes(1);
    expect(checkAndNotifyLowStock).toHaveBeenCalledWith({
      assetId: "q1",
      userId: "user-1",
      organizationId: "org-1",
    });
  });

  it("words a self-service hand-over as taking custody, with the operator's text", async () => {
    await assignQuantityToCustodian({
      ...args,
      role: OrganizationRoles.SELF_SERVICE,
      note: "For the night shoot",
    });

    expect(vi.mocked(createNote).mock.calls[0][0].content).toBe(
      `${ACTOR} took custody of **3** unit(s). *"For the night shoot"*`
    );
  });

  it("writes nothing more when the assignment is refused", async () => {
    vi.mocked(checkOutQuantity).mockRejectedValueOnce(new Error("refused"));

    await expect(assignQuantityToCustodian(args)).rejects.toThrow("refused");
    expect(createNote).not.toHaveBeenCalled();
    expect(checkAndNotifyLowStock).not.toHaveBeenCalled();
  });

  it("does not fail a completed assignment when the note or the check fails", async () => {
    vi.mocked(createNote).mockRejectedValueOnce(new Error("note down"));
    vi.mocked(checkAndNotifyLowStock).mockRejectedValueOnce(
      new Error("mail down")
    );

    await expect(assignQuantityToCustodian(args)).resolves.toBeUndefined();
    expect(checkAndNotifyLowStock).toHaveBeenCalledTimes(1);
  });
});

describe("releaseQuantityFromCustodian", () => {
  const args = {
    assetId: "q1",
    custodian,
    quantity: 3,
    userId: "user-1",
    organizationId: "org-1",
    role: OrganizationRoles.ADMIN,
  };

  it.each([
    [
      "returned to stock",
      { consumed: 0, returned: 3 },
      `${ACTOR} released **3** unit(s) from **Jane Doe**'s custody.`,
    ],
    [
      "used up",
      { consumed: 3, returned: 0 },
      `${ACTOR} marked **3** unit(s) held by **Jane Doe** as consumed. Stock reduced permanently.`,
    ],
    [
      "split",
      { consumed: 1, returned: 2 },
      `${ACTOR} ended **Jane Doe**'s hold on **3** unit(s): **1** consumed and **2** returned to stock.`,
    ],
  ])(
    "words the note from what was persisted when the units are %s",
    async (_label, split, content) => {
      vi.mocked(releaseQuantity).mockResolvedValueOnce(
        split as Awaited<ReturnType<typeof releaseQuantity>>
      );

      await expect(releaseQuantityFromCustodian(args)).resolves.toEqual(split);
      expect(createNote).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createNote).mock.calls[0][0].content).toBe(content);
      expect(checkAndNotifyLowStock).toHaveBeenCalledTimes(1);
    }
  );

  it("forwards the holder, the units and the used-up split to the service", async () => {
    await releaseQuantityFromCustodian({ ...args, consumed: 1 });

    expect(releaseQuantity).toHaveBeenCalledWith({
      assetId: "q1",
      teamMemberId: "tm-1",
      quantity: 3,
      consumed: 1,
      userId: "user-1",
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      note: undefined,
    });
  });
});
