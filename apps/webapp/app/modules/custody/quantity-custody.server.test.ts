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
import { accessFor } from "@helpers/role-access";
import { computeCustodyAvailability } from "~/modules/asset/availability-primitives.server";
import { loadCustodySources } from "~/modules/asset/custody-source.server";
import type * as CustodySourceServer from "~/modules/asset/custody-source.server";
import {
  checkOutQuantity,
  releaseQuantity,
} from "~/modules/asset/service.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { createNote } from "~/modules/note/service.server";
import { ShelfError } from "~/utils/error";
import {
  assertAssignableQuantities,
  assignQuantities,
  assignQuantityToCustodian,
  quantityRefusalsError,
  releaseQuantities,
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
  locationFindFirst: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findFirst: dbMocks.assetFindFirst },
    custody: { findMany: dbMocks.custodyFindMany },
    location: { findFirst: dbMocks.locationFindFirst },
  },
}));

// why: a pool's placements, custody and booked-out units come from several
// tables; these tests are about what the pre-flight decides from that state
vi.mock("~/modules/asset/custody-source.server", async (importOriginal) => ({
  ...(await importOriginal<typeof CustodySourceServer>()),
  loadCustodySources: vi.fn(),
}));

// why: the free-unit count has its own suite in the availability leaf
vi.mock("~/modules/asset/availability-primitives.server", () => ({
  computeCustodyAvailability: vi.fn(),
}));

// why: the custody writes are the services' job and have their own suites;
// here they only need to succeed or refuse. The resolved values carry the
// source each service reports: none worth naming, so notes read as before.
vi.mock("~/modules/asset/service.server", () => ({
  checkOutQuantity: vi.fn().mockResolvedValue({
    source: {
      locationId: null,
      locationName: null,
      explicit: false,
      multiSource: false,
    },
  }),
  releaseQuantity: vi.fn().mockResolvedValue({
    consumed: 0,
    returned: 3,
    lines: [],
    multiSource: false,
  }),
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
  function freeUnits(free: Record<string, number>, individual: string[] = []) {
    dbMocks.assetFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id in free || individual.includes(where.id)
            ? {
                title: `Asset ${where.id}`,
                quantity: 50,
                type: individual.includes(where.id)
                  ? "INDIVIDUAL"
                  : "QUANTITY_TRACKED",
              }
            : null
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
        custodian,
        custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
        userId: "user-1",
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
        custodian,
        custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
        userId: "user-1",
      })
    ).rejects.toMatchObject({
      status: 400,
      message:
        'Nothing was assigned. "Asset q1" (asked for 6, 5 free); "Asset q3" (asked for 10, 9 free).',
    });
  });

  it("refuses an asset that is not in the workspace or not tracked by quantity", async () => {
    freeUnits({ q1: 5 }, ["camera"]);
    await expect(
      assertAssignableQuantities({
        quantityAssetIds: ["elsewhere", "camera", "q1"],
        quantities: { elsewhere: 1, camera: 1, q1: 2 },
        organizationId: "org-1",
        custodian,
        custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
        userId: "user-1",
      })
    ).rejects.toMatchObject({
      status: 400,
      message:
        'Nothing was assigned. an asset that is not in this workspace; "Asset camera" (not tracked by quantity).',
    });
  });

  describe("with a chosen source location", () => {
    beforeEach(() => {
      freeUnits({ q1: 50 });
      // 30 placed at the Store, all 10 Studio units out on a booking.
      vi.mocked(loadCustodySources).mockResolvedValue({
        state: {
          total: 50,
          placements: [
            { locationId: "loc-store", quantity: 30 },
            { locationId: "loc-studio", quantity: 10 },
          ],
          operatorCustody: [],
          bookedOut: [{ locationId: "loc-studio", quantity: 10 }],
        },
        rows: [],
      });
      dbMocks.locationFindFirst.mockResolvedValue({ name: "Studio" });
    });

    function assignFrom(locationId: string, quantity: number) {
      return assertAssignableQuantities({
        quantityAssetIds: ["q1"],
        quantities: { q1: quantity },
        sourceLocations: { q1: locationId },
        organizationId: "org-1",
        custodian,
        custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
        userId: "user-1",
      });
    }

    it("passes when the location has the units left", async () => {
      await expect(assignFrom("loc-store", 30)).resolves.toBeUndefined();
    });

    it("names how many are left at a placed location", async () => {
      await expect(assignFrom("loc-studio", 1)).rejects.toMatchObject({
        status: 400,
        message:
          'Nothing was assigned. "Asset q1" (asked for 1, 0 left at Studio).',
      });
    });

    it("refuses a location the pool is not placed at, without counting units there", async () => {
      await expect(assignFrom("loc-removed", 1)).rejects.toMatchObject({
        status: 400,
        message:
          'Nothing was assigned. "Asset q1" (not placed at the chosen location).',
      });
      expect(dbMocks.locationFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("for a self-service user", () => {
    function custodianFor(userId: string | null): QuantityCustodian {
      return {
        id: "tm-1",
        name: "Holder",
        user: userId
          ? { id: userId, firstName: null, lastName: null, displayName: null }
          : null,
      };
    }

    it("passes when the units go to the caller", async () => {
      freeUnits({ q1: 5 });
      await expect(
        assertAssignableQuantities({
          quantityAssetIds: ["q1"],
          quantities: { q1: 2 },
          organizationId: "org-1",
          custodian: custodianFor("user-self"),
          custodyAssign: accessFor([OrganizationRoles.SELF_SERVICE]).custody
            .assign,
          userId: "user-self",
        })
      ).resolves.toBeUndefined();
    });

    it.each([
      ["a colleague", "user-other"],
      ["a team member without an account", null],
    ])(
      "refuses before any lookup when the units go to %s",
      async (_label, receiver) => {
        freeUnits({ q1: 5 });
        await expect(
          assertAssignableQuantities({
            quantityAssetIds: ["q1"],
            quantities: { q1: 2 },
            organizationId: "org-1",
            custodian: custodianFor(receiver),
            custodyAssign: accessFor([OrganizationRoles.SELF_SERVICE]).custody
              .assign,
            userId: "user-self",
          })
        ).rejects.toMatchObject({
          status: 403,
          message:
            "Nothing was assigned. Self-service users can only assign custody to themselves.",
        });
        expect(dbMocks.assetFindFirst).not.toHaveBeenCalled();
      }
    );

    it("leaves a submission with no unit rows to the bulk service", async () => {
      // Whole assets are refused by bulkCheckOutAssets with its own message.
      await expect(
        assertAssignableQuantities({
          quantityAssetIds: [],
          quantities: {},
          organizationId: "org-1",
          custodian: custodianFor("user-other"),
          custodyAssign: accessFor([OrganizationRoles.SELF_SERVICE]).custody
            .assign,
          userId: "user-self",
        })
      ).resolves.toBeUndefined();
    });
  });
});

describe("resolveQuantityReleases", () => {
  function row(
    assetId: string,
    teamMemberId: string,
    quantity: number,
    type = "QUANTITY_TRACKED"
  ) {
    return {
      assetId,
      quantity,
      asset: { title: `Asset ${assetId}`, type },
      custodian: { id: teamMemberId, name: teamMemberId, user: null },
    };
  }

  it("needs no lookup when nothing is released by units", async () => {
    await expect(
      resolveQuantityReleases({
        quantityAssetIds: [],
        quantities: {},
        organizationId: "org-1",
        custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
        userId: "user-1",
      })
    ).resolves.toEqual([]);
    expect(dbMocks.custodyFindMany).not.toHaveBeenCalled();
  });

  it("counts one person holding units from two locations as one holder", async () => {
    // One operator row per location the units came from, same person.
    dbMocks.custodyFindMany.mockResolvedValue([
      row("q1", "tm-1", 2),
      row("q1", "tm-1", 3),
    ]);

    const resolved = await resolveQuantityReleases({
      quantityAssetIds: ["q1"],
      quantities: { q1: 5 },
      organizationId: "org-1",
      custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
      userId: "user-1",
    });

    expect(resolved).toEqual([
      { assetId: "q1", custodian: { id: "tm-1", name: "tm-1", user: null } },
    ]);
  });

  it("resolves each asset to its single operator holder", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([row("q1", "tm-1", 8)]);

    const resolved = await resolveQuantityReleases({
      quantityAssetIds: ["q1"],
      quantities: { q1: 8 },
      organizationId: "org-1",
      custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
      userId: "user-1",
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
    [
      // releaseQuantity would refuse it on the write, after earlier assets
      // were released, and the route would report a partial success.
      "the asset is not tracked by quantity",
      [row("q1", "tm-1", 1, "INDIVIDUAL")],
      'Nothing was released. "Asset q1" is not tracked by quantity, so it is released whole, not by units.',
    ],
  ])("refuses when %s", async (_label, rows, message) => {
    dbMocks.custodyFindMany.mockResolvedValue(rows);
    await expect(
      resolveQuantityReleases({
        quantityAssetIds: ["q1"],
        quantities: { q1: 3 },
        organizationId: "org-1",
        custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
        userId: "user-1",
      })
    ).rejects.toMatchObject({ status: 400, message });
  });
});

describe("resolveQuantityReleases for a self-service user", () => {
  function heldBy(userId: string | null) {
    return {
      assetId: "q1",
      quantity: 5,
      asset: { title: "Cable", type: "QUANTITY_TRACKED" },
      custodian: {
        id: "tm-1",
        name: "Holder",
        user: userId
          ? { id: userId, firstName: null, lastName: null, displayName: null }
          : null,
      },
    };
  }

  it("releases units the caller holds", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([heldBy("user-self")]);
    await expect(
      resolveQuantityReleases({
        quantityAssetIds: ["q1"],
        quantities: { q1: 2 },
        organizationId: "org-1",
        custodyAssign: accessFor([OrganizationRoles.SELF_SERVICE]).custody
          .assign,
        userId: "user-self",
      })
    ).resolves.toHaveLength(1);
  });

  it.each([
    ["a colleague", "user-other"],
    ["a team member without an account", null],
  ])("refuses before any write when %s holds them", async (_label, holder) => {
    dbMocks.custodyFindMany.mockResolvedValue([heldBy(holder)]);
    await expect(
      resolveQuantityReleases({
        quantityAssetIds: ["q1"],
        quantities: { q1: 2 },
        organizationId: "org-1",
        custodyAssign: accessFor([OrganizationRoles.SELF_SERVICE]).custody
          .assign,
        userId: "user-self",
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("assignQuantities and releaseQuantities", () => {
  beforeEach(() => {
    dbMocks.assetFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({ title: `Asset ${where.id}` })
    );
  });

  it("keeps going past a refused asset and reports it by name", async () => {
    const assigned = {
      source: {
        locationId: null,
        locationName: null,
        explicit: false,
        multiSource: false,
      },
    } as never;
    vi.mocked(checkOutQuantity)
      .mockResolvedValueOnce(assigned)
      .mockRejectedValueOnce(
        new ShelfError({
          cause: null,
          label: "Assets",
          message: "Cannot check out 3 units. Only 1 units are available.",
        })
      )
      .mockResolvedValueOnce(assigned);

    const refusals = await assignQuantities({
      quantityAssetIds: ["q1", "q2", "q3"],
      quantities: { q1: 1, q2: 3, q3: 2 },
      custodian,
      userId: "user-1",
      organizationId: "org-1",
      custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
    });

    expect(checkOutQuantity).toHaveBeenCalledTimes(3);
    expect(refusals).toEqual([
      {
        assetId: "q2",
        title: "Asset q2",
        message: "Cannot check out 3 units. Only 1 units are available.",
      },
    ]);
    // Notes only for the assignments that landed.
    expect(createNote).toHaveBeenCalledTimes(2);
  });

  it("reports nothing when every release lands", async () => {
    const refusals = await releaseQuantities({
      releases: [
        { assetId: "q1", custodian },
        { assetId: "q2", custodian },
      ],
      quantities: { q1: 1, q2: 2 },
      userId: "user-1",
      organizationId: "org-1",
      custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
    });
    expect(refusals).toEqual([]);
    expect(releaseQuantity).toHaveBeenCalledTimes(2);
  });

  it("hides an unexpected failure behind a plain reason", async () => {
    vi.mocked(releaseQuantity).mockRejectedValueOnce(new TypeError("boom"));
    const refusals = await releaseQuantities({
      releases: [{ assetId: "q1", custodian }],
      quantities: { q1: 1 },
      userId: "user-1",
      organizationId: "org-1",
      custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
    });
    expect(refusals).toEqual([
      {
        assetId: "q1",
        title: "Asset q1",
        message: "Something went wrong. Please try again.",
      },
    ]);
  });

  it("words a web refusal so a retry does not repeat what landed", () => {
    const refusal = quantityRefusalsError("assigned", [
      { assetId: "q2", title: "Cable", message: "Only 1 units are available." },
    ]);
    expect(refusal.status).toBe(409);
    expect(refusal.message).toBe(
      'Everything else was assigned. Not assigned: "Cable": Only 1 units are available.'
    );
  });
});

describe("assignQuantityToCustodian", () => {
  const args = {
    assetId: "q1",
    custodian,
    quantity: 3,
    userId: "user-1",
    organizationId: "org-1",
    custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
  };

  it("assigns, writes one audit note, and runs the low-stock check", async () => {
    await assignQuantityToCustodian(args);

    expect(checkOutQuantity).toHaveBeenCalledWith({
      assetId: "q1",
      teamMemberId: "tm-1",
      quantity: 3,
      userId: "user-1",
      organizationId: "org-1",
      custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
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
      custodyAssign: accessFor([OrganizationRoles.SELF_SERVICE]).custody.assign,
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
    custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
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
      custodyAssign: accessFor([OrganizationRoles.ADMIN]).custody.assign,
      note: undefined,
    });
  });
});
