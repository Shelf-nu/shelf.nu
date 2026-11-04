import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import Markdoc from "@markdoc/markdoc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { URL_SHAPED_VALUE, expectValueOnlyInTag } from "@helpers/note-tags";
import { Logger } from "~/utils/logger";

import {
  createAssetLocationMoveNotes,
  createLocationNote,
  placementChangeMoves,
  createSystemLocationNote,
  deleteLocationNote,
  getLocationNotes,
} from "./service.server";

// why: testing location note service logic without touching the real database
// why: a failed log write is reported, not thrown; the test reads the report.
vi.mock("~/utils/logger", () => ({ Logger: { error: vi.fn() } }));

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

  it("adds up the slices of one asset that arrive together", async () => {
    const sandbags = {
      id: "sandbags",
      title: "Sandbags",
      type: "QUANTITY_TRACKED" as const,
      unitOfMeasure: "bags",
    };
    await createAssetLocationMoveNotes({
      actor,
      moves: [
        { asset: sandbags, from: unitA, to: dock, quantity: 5 },
        { asset: sandbags, from: unitB, to: dock, quantity: 3 },
      ],
    });

    expect(rows()[0]).toEqual([
      "loc-dock",
      `${ADA} added 8 bags of {% link to="/assets/sandbags" text="Sandbags" /%} to ${loc(
        "loc-dock",
        "Dock"
      )}. Moved from ${loc("loc-a", "Unit A")}, ${loc("loc-b", "Unit B")}.`,
    ]);
  });

  it("keeps typed names inside tag attributes, so they cannot inject a tag", async () => {
    const payload = '{% link to="javascript:alert(1)" text="x" /%}';
    await createAssetLocationMoveNotes({
      actor: { ...actor, displayName: payload },
      moves: [
        {
          asset: { id: "a-1", title: payload, type: "INDIVIDUAL" },
          from: { id: "loc-1", name: payload },
          to: { id: "loc-2", name: URL_SHAPED_VALUE },
        },
      ],
    });

    for (const [, content] of rows()) {
      const tags = [...Markdoc.parse(content).walk()].filter(
        (node) => node.type === "tag"
      );
      expect(tags.map((tag) => tag.tag)).toEqual(
        expect.arrayContaining(["link"])
      );
      expect(
        tags.every((tag) => !String(tag.attributes.to).startsWith("javascript"))
      ).toBe(true);
      expectValueOnlyInTag(content);
    }
  });

  it("logs a failed write instead of failing the move it describes", async () => {
    vi.mocked(mockDb.db.locationNote.createMany).mockRejectedValueOnce(
      new Error("connection reset")
    );

    await expect(
      createAssetLocationMoveNotes({
        actor,
        moves: [{ asset: pallet(1), from: unitA, to: dock }],
      })
    ).resolves.toBeUndefined();
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for a move that stays at the same location", async () => {
    await createAssetLocationMoveNotes({
      actor,
      moves: [{ asset: pallet(1), from: dock, to: dock }],
    });

    expect(mockDb.db.locationNote.createMany).not.toHaveBeenCalled();
  });
});

describe("placementChangeMoves", () => {
  const cords = {
    id: "cords",
    title: "Cords",
    type: "QUANTITY_TRACKED" as const,
    unitOfMeasure: "pcs",
  };
  const storage = { id: "loc-storage", name: "Storage" };
  const van = { id: "loc-van", name: "Van" };

  /** Moves as `[from, to, quantity]`, for readable expectations. */
  function moves(args: Parameters<typeof placementChangeMoves>[0]) {
    return placementChangeMoves(args).map((move) => [
      move.from?.name ?? null,
      move.to?.name ?? null,
      move.quantity,
    ]);
  }

  it("splits a replace into the units that moved and the units left unplaced", () => {
    expect(
      moves({
        asset: cords,
        before: [{ location: storage, quantity: 10 }],
        after: [{ location: van, quantity: 4 }],
      })
    ).toEqual([
      ["Storage", "Van", 4],
      ["Storage", null, 6],
    ]);
  });

  it("leaves out a location whose amount did not change", () => {
    expect(
      moves({
        asset: cords,
        before: [
          { location: storage, quantity: 6 },
          { location: van, quantity: 4 },
        ],
        after: [{ location: van, quantity: 4 }],
      })
    ).toEqual([["Storage", null, 6]]);
  });

  it("takes extra units at a location from the unplaced pool", () => {
    expect(
      moves({
        asset: cords,
        before: [{ location: van, quantity: 4 }],
        after: [{ location: van, quantity: 10 }],
      })
    ).toEqual([[null, "Van", 6]]);
  });

  it("pairs several losses with several gains in the order of the rows", () => {
    const shelf = { id: "loc-shelf", name: "Shelf" };
    const bench = { id: "loc-bench", name: "Bench" };
    expect(
      moves({
        asset: cords,
        before: [
          { location: storage, quantity: 6 },
          { location: van, quantity: 4 },
        ],
        after: [
          { location: shelf, quantity: 5 },
          { location: bench, quantity: 5 },
        ],
      })
    ).toEqual([
      ["Storage", "Shelf", 5],
      ["Storage", "Bench", 1],
      ["Van", "Bench", 4],
    ]);
  });

  it("moves an individual asset as one unit", () => {
    expect(
      moves({
        asset: { id: "tripod", title: "Tripod", type: "INDIVIDUAL" },
        before: [{ location: storage, quantity: 1 }],
        after: [{ location: van, quantity: 1 }],
      })
    ).toEqual([["Storage", "Van", 1]]);
  });
});

/**
 * Every flow that records `ASSET_LOCATION_CHANGED` has to write the location
 * activity log too, or a location's Activity tab and CSV silently miss the
 * move. Checked per top-level declaration (function, or `const` such as an
 * arrow-function route handler), with comments stripped, so a new writer
 * cannot skip it by living in a file that already calls the helper. It checks
 * that the helper is called, not how many times: one call covers a batch.
 */
describe("ASSET_LOCATION_CHANGED writers", () => {
  /**
   * Declarations that write their location line another way, keyed
   * `<file>#<declaration>`, with the reason.
   */
  const WRITES_ITS_LOCATION_LINE_ELSEWHERE: Record<string, string> = {
    "app/modules/asset/service.server.ts#placeUnplacedUnits":
      "logs its own 'placed N units at L' line",
    "app/modules/location/service.server.ts#updateLocationAssets":
      "writes its lines through createBulkLocationChangeNotes",
  };

  const RECORDS_THE_EVENT =
    /action:\s*(?:["'`]ASSET_LOCATION_CHANGED["'`]|ActivityAction\.ASSET_LOCATION_CHANGED)/;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [path]
        : [];
    });
  }

  /** Removes line and block comments, so a mention in prose does not count. */
  function withoutComments(source: string) {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  }

  /**
   * Splits a source file into its top-level declarations, by name. Code
   * before the first one is kept as `<module>`.
   */
  function topLevelDeclarations(source: string) {
    const starts = [
      ...source.matchAll(
        /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+(\w+)|(?:const|let)\s+(\w+)\s*[=:])/gm
      ),
    ];
    const head = { name: "<module>", body: source.slice(0, starts[0]?.index) };
    return [
      head,
      ...starts.map((match, i) => ({
        name: match[1] ?? match[2],
        body: source.slice(match.index, starts[i + 1]?.index ?? source.length),
      })),
    ];
  }

  it("also write the location activity log", () => {
    const appRoot = join(__dirname, "../..");
    const webappRoot = join(appRoot, "..");
    const writers = sourceFiles(appRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      if (!source.includes("ASSET_LOCATION_CHANGED")) return [];
      return topLevelDeclarations(withoutComments(source))
        .filter(({ body }) => RECORDS_THE_EVENT.test(body))
        .map(({ name, body }) => ({
          key: `${relative(webappRoot, path)}#${name}`,
          body,
        }));
    });

    expect(writers.length).toBeGreaterThan(5);
    const missing = writers
      .filter(
        ({ key, body }) =>
          !(key in WRITES_ITS_LOCATION_LINE_ELSEWHERE) &&
          !body.includes("createAssetLocationMoveNotes(")
      )
      .map(({ key }) => key);
    expect(missing).toEqual([]);

    // An allow-listed declaration that no longer records the event is stale.
    const writerKeys = new Set(writers.map(({ key }) => key));
    expect(
      Object.keys(WRITES_ITS_LOCATION_LINE_ELSEWHERE).filter(
        (key) => !writerKeys.has(key)
      )
    ).toEqual([]);
  });
});
