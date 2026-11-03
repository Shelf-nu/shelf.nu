import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAssetLocationMoveNotes,
  createLocationNote,
  createSystemLocationNote,
  deleteLocationNote,
  getLocationNotes,
} from "./service.server";

// why: testing location note service logic without touching the real database
vi.mock("~/database/db.server", () => ({
  db: {
    locationNote: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    location: {
      findFirst: vi.fn(),
    },
  },
}));

// why: testing error handling behavior without depending on ShelfError implementation
vi.mock("~/utils/error", () => ({
  ShelfError: class ShelfError extends Error {
    constructor(config: any) {
      super(config.message);
      Object.assign(this, config);
    }
  },
}));

const mockDb = await import("~/database/db.server");

const locationNoteCreateMock = vi.mocked(mockDb.db.locationNote.create);
const locationNoteFindManyMock = vi.mocked(mockDb.db.locationNote.findMany);
const locationNoteDeleteManyMock = vi.mocked(mockDb.db.locationNote.deleteMany);
const locationFindFirstMock = vi.mocked(mockDb.db.location.findFirst);

describe("location note service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createLocationNote", () => {
    it("creates a note associated to the user and location", async () => {
      const note = {
        id: "lnote-1",
        content: "Manual note",
        type: "COMMENT",
        locationId: "loc-1",
        userId: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const;

      locationNoteCreateMock.mockResolvedValue(note);

      const result = await createLocationNote({
        content: "Manual note",
        locationId: "loc-1",
        userId: "user-1",
        type: "COMMENT",
      });

      expect(locationNoteCreateMock).toHaveBeenCalledWith({
        data: {
          content: "Manual note",
          type: "COMMENT",
          location: { connect: { id: "loc-1" } },
          user: { connect: { id: "user-1" } },
        },
      });
      expect(result).toEqual(note);
    });

    it("allows creating a system note without a user", async () => {
      const note = {
        id: "lnote-2",
        content: "System note",
        type: "UPDATE",
        locationId: "loc-1",
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const;

      locationNoteCreateMock.mockResolvedValue(note);

      const result = await createLocationNote({
        content: "System note",
        locationId: "loc-1",
        type: "UPDATE",
      });

      expect(locationNoteCreateMock).toHaveBeenCalledWith({
        data: {
          content: "System note",
          type: "UPDATE",
          location: { connect: { id: "loc-1" } },
        },
      });
      expect(result).toEqual(note);
    });
  });

  describe("createSystemLocationNote", () => {
    it("forces UPDATE type and omits user linkage", async () => {
      const note = {
        id: "lnote-3",
        content: "Profile updated",
        type: "UPDATE",
        locationId: "loc-1",
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const;

      locationNoteCreateMock.mockResolvedValue(note);

      const result = await createSystemLocationNote({
        content: "Profile updated",
        locationId: "loc-1",
      });

      expect(locationNoteCreateMock).toHaveBeenCalledWith({
        data: {
          content: "Profile updated",
          type: "UPDATE",
          location: { connect: { id: "loc-1" } },
        },
      });
      expect(result).toEqual(note);
    });
  });

  describe("getLocationNotes", () => {
    it("returns notes when location belongs to organization", async () => {
      const notes = [
        {
          id: "lnote-1",
          content: "Manual",
          type: "COMMENT" as const,
          locationId: "loc-1",
          userId: "user-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { firstName: "Jane", lastName: "Doe" },
        },
      ];

      locationFindFirstMock.mockResolvedValue({ id: "loc-1" } as any);
      locationNoteFindManyMock.mockResolvedValue(notes);

      const result = await getLocationNotes({
        locationId: "loc-1",
        organizationId: "org-1",
      });

      expect(locationFindFirstMock).toHaveBeenCalledWith({
        where: { id: "loc-1", organizationId: "org-1" },
        select: { id: true },
      });

      expect(locationNoteFindManyMock).toHaveBeenCalledWith({
        where: { locationId: "loc-1" },
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      });

      expect(result).toEqual(notes);
    });

    it("throws when location does not belong to organization", async () => {
      locationFindFirstMock.mockResolvedValue(null);

      await expect(
        getLocationNotes({ locationId: "loc-2", organizationId: "org-9" })
      ).rejects.toThrow("Location not found or access denied");
    });
  });

  describe("deleteLocationNote", () => {
    it("scopes the delete to the caller's organization, via the location", async () => {
      locationNoteDeleteManyMock.mockResolvedValue({ count: 1 });

      await deleteLocationNote({
        id: "lnote-1",
        userId: "user-1",
        organizationId: "org-1",
      });

      // LocationNote has no organizationId column, so the scope comes through
      // the parent location.
      expect(locationNoteDeleteManyMock).toHaveBeenCalledWith({
        where: {
          id: "lnote-1",
          userId: "user-1",
          location: { organizationId: "org-1" },
        },
      });
    });

    it("throws 403 rather than silently reporting nothing deleted", async () => {
      locationNoteDeleteManyMock.mockResolvedValue({ count: 0 });

      await expect(
        deleteLocationNote({
          id: "someone-elses-note",
          userId: "user-1",
          organizationId: "org-1",
        })
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});

describe("createAssetLocationMoveNotes", () => {
  const actor = {
    id: "user-1",
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: null,
  };
  const ADA =
    '{% link to="/settings/team/users/user-1" text="Ada Lovelace" /%}';
  const loc = (id: string, name: string) =>
    `{% link to="/locations/${id}" text="${name}" /%}`;
  const pallet = (n: number) => ({
    id: `pallet-${n}`,
    title: `Pallet ${n}`,
    type: "INDIVIDUAL" as const,
  });
  const dock = { id: "loc-dock", name: "Dock" };
  const unitA = { id: "loc-a", name: "Unit A" };
  const unitB = { id: "loc-b", name: "Unit B" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** The rows written, as `[locationId, content]`. */
  function rows() {
    return vi
      .mocked(mockDb.db.locationNote.createMany)
      .mock.calls.flatMap(([args]) => (args?.data ?? []) as never[])
      .map((row: { locationId: string; content: string }) => [
        row.locationId,
        row.content,
      ]);
  }

  it("writes one arrival line per destination and one departure line per source", async () => {
    await createAssetLocationMoveNotes({
      actor,
      moves: [
        { asset: pallet(1), from: unitA, to: dock },
        { asset: pallet(2), from: unitB, to: dock },
        { asset: pallet(3), from: unitA, to: dock },
      ],
    });

    expect(rows()).toEqual([
      [
        "loc-dock",
        `${ADA} added {% assets_list count=3 ids="pallet-1,pallet-2,pallet-3" action="added" /%} to ${loc(
          "loc-dock",
          "Dock"
        )}. Moved from ${loc("loc-a", "Unit A")}, ${loc("loc-b", "Unit B")}.`,
      ],
      [
        "loc-a",
        `${ADA} removed {% assets_list count=2 ids="pallet-1,pallet-3" action="removed" /%} from ${loc(
          "loc-a",
          "Unit A"
        )}. Moved to ${loc("loc-dock", "Dock")}.`,
      ],
      [
        "loc-b",
        `${ADA} removed {% link to="/assets/pallet-2" text="Pallet 2" /%} from ${loc(
          "loc-b",
          "Unit B"
        )}. Moved to ${loc("loc-dock", "Dock")}.`,
      ],
    ]);
  });

  it("names the unit count when one quantity-tracked asset moves", async () => {
    await createAssetLocationMoveNotes({
      actor,
      moves: [
        {
          asset: {
            id: "boxes",
            title: "Boxes",
            type: "QUANTITY_TRACKED",
            unitOfMeasure: "boxes",
          },
          from: null,
          to: dock,
          quantity: 12,
        },
      ],
    });

    expect(rows()).toEqual([
      [
        "loc-dock",
        `${ADA} added 12 boxes of {% link to="/assets/boxes" text="Boxes" /%} to ${loc(
          "loc-dock",
          "Dock"
        )}.`,
      ],
    ]);
  });

  it("writes nothing for a move that stays at the same location", async () => {
    await createAssetLocationMoveNotes({
      actor,
      moves: [{ asset: pallet(1), from: dock, to: dock }],
    });

    expect(mockDb.db.locationNote.createMany).not.toHaveBeenCalled();
  });
});

/**
 * Every flow that records `ASSET_LOCATION_CHANGED` has to write the location
 * activity log too, or a location's Activity tab and CSV silently miss the
 * move. This keeps a new writer from forgetting it.
 */
describe("ASSET_LOCATION_CHANGED writers", () => {
  /**
   * Writers whose location line comes from a different note on purpose.
   * The stock adjustment logs "added N units at L (adjustment)" through
   * `createCustodySourceLocationNote`.
   */
  const WRITES_ITS_OWN_LOCATION_LINE = [
    "app/modules/consumption-log/service.server.ts",
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [path]
        : [];
    });
  }

  it("also write the location activity log", () => {
    const appRoot = join(__dirname, "../..");
    const webappRoot = join(appRoot, "..");
    const writers = sourceFiles(appRoot)
      .filter((path) =>
        /action:\s*"ASSET_LOCATION_CHANGED"/.test(readFileSync(path, "utf8"))
      )
      .map((path) => relative(webappRoot, path));

    expect(writers.length).toBeGreaterThan(0);
    const missing = writers.filter(
      (path) =>
        !WRITES_ITS_OWN_LOCATION_LINE.includes(path) &&
        !readFileSync(join(webappRoot, path), "utf8").includes(
          "createAssetLocationMoveNotes("
        )
    );
    expect(missing).toEqual([]);
  });
});
