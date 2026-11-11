/**
 * Which locations the companion's location lists receive.
 *
 * Two kinds of caller share this endpoint. The full-screen location picker
 * pages explicitly (`page` + `perPage`). The asset create and edit forms send
 * neither and filter the response on the device, so anything left off that
 * one response can never be picked from those forms. Requests without paging
 * params therefore get the whole list; paged requests keep their pages.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/locations.ts} loader under test
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { loader } from "~/routes/api+/mobile+/locations";

// @vitest-environment node

// why: the module instantiates a real Prisma client at load and would try to
// connect; the suite runs with no database. The mocks below apply `skip` and
// `take` to an in-memory list so the tests see what the query would return.
vi.mock("~/database/db.server", () => ({
  db: {
    location: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// why: JWT validation and org-membership resolution are out of scope here.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
}));

type Body = {
  locations: Array<{ id: string; name: string; image: string | null }>;
  page?: number;
  perPage?: number;
  totalCount: number;
  totalPages?: number;
  truncated?: boolean;
};

type FindManyArgs = {
  where?: { name?: { contains: string } };
  skip?: number;
  take?: number;
};

/**
 * A workspace with `n` locations named "Room 0001" upwards, plus `others`
 * named "Shelf 0001" upwards, already in name order. The mocks apply the
 * name search, `skip` and `take` the way the database would.
 */
function seedLocations(n: number, others = 0) {
  /** The `i`th location named with `prefix`, shaped like the route's select. */
  const row = (prefix: string, i: number) => ({
    id: `${prefix.toLowerCase()}-${i + 1}`,
    name: `${prefix} ${String(i + 1).padStart(4, "0")}`,
    description: null,
    thumbnailUrl: `https://img.example.com/${prefix}-${i + 1}-thumb.jpg`,
    imageUrl: `https://img.example.com/${prefix}-${i + 1}.jpg`,
    parentId: null,
  });
  const all = [
    ...Array.from({ length: n }, (_, i) => row("Room", i)),
    ...Array.from({ length: others }, (_, i) => row("Shelf", i)),
  ];
  /** The seeded rows that pass the query's name search, if it has one. */
  const matching = (args?: FindManyArgs) => {
    const needle = args?.where?.name?.contains?.toLowerCase();
    return needle
      ? all.filter((l) => l.name.toLowerCase().includes(needle))
      : all;
  };

  vi.mocked(db.location.findMany).mockImplementation(((args?: FindManyArgs) => {
    const skip = args?.skip ?? 0;
    const end = args?.take === undefined ? undefined : skip + args.take;
    return Promise.resolve(matching(args).slice(skip, end));
  }) as unknown as typeof db.location.findMany);
  vi.mocked(db.location.count).mockImplementation(((args?: FindManyArgs) =>
    Promise.resolve(
      matching(args).length
    )) as unknown as typeof db.location.count);
}

/** The arguments of the last location query the loader ran. */
function lastFindManyArgs() {
  return vi.mocked(db.location.findMany).mock.calls.at(-1)?.[0];
}

/** Calls the loader as org-1 with the given extra query string. */
async function get(query = "") {
  const response = await loader(
    createLoaderArgs({
      request: new Request(
        `http://localhost:3000/api/mobile/locations?orgId=org-1${query}`
      ),
    })
  );
  return response.data as Body;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
});

describe("GET /api/mobile/locations: requests without paging params", () => {
  it("returns every location when the workspace has more than 50", async () => {
    seedLocations(76);

    const body = await get();

    expect(body.locations).toHaveLength(76);
    expect(body.locations.at(-1)?.id).toBe("room-76");
    expect(body).toEqual({
      locations: expect.any(Array),
      totalCount: 76,
      truncated: false,
    });
    expect(lastFindManyArgs()).toMatchObject({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: 0,
    });
  });

  it("returns every match for a search, and only matches", async () => {
    seedLocations(120, 30);

    const body = await get("&search=room");

    expect(body.locations).toHaveLength(120);
    expect(body.locations.every((l) => l.name.startsWith("Room"))).toBe(true);
    expect(body).toMatchObject({ totalCount: 120, truncated: false });
  });

  it("sends the thumbnail URL as the image, never the stored image row", async () => {
    seedLocations(1);

    const body = await get();

    expect(body.locations[0]?.image).toBe(
      "https://img.example.com/Room-1-thumb.jpg"
    );
    expect(lastFindManyArgs()?.select).not.toHaveProperty("image");
  });

  it("falls back to the full image URL when there is no thumbnail", async () => {
    vi.mocked(db.location.findMany).mockResolvedValue([
      {
        id: "room-1",
        name: "Room 0001",
        description: null,
        thumbnailUrl: null,
        imageUrl: "https://img.example.com/Room-1.jpg",
        parentId: null,
      },
    ] as unknown as Awaited<ReturnType<typeof db.location.findMany>>);
    vi.mocked(db.location.count).mockResolvedValue(1);

    const body = await get();

    expect(body.locations[0]?.image).toBe("https://img.example.com/Room-1.jpg");
  });

  it("stops at the hard cap and says the list was cut, without paging fields", async () => {
    seedLocations(1500);

    const body = await get();

    expect(body.locations).toHaveLength(1000);
    expect(body).toEqual({
      locations: expect.any(Array),
      totalCount: 1500,
      truncated: true,
    });
  });
});

describe("GET /api/mobile/locations: paged requests", () => {
  it("returns the requested page", async () => {
    seedLocations(76);

    const body = await get("&page=2&perPage=50");

    expect(body.locations).toHaveLength(26);
    expect(body.locations[0]?.id).toBe("room-51");
    expect(body).toMatchObject({
      page: 2,
      perPage: 50,
      totalCount: 76,
      totalPages: 2,
    });
  });

  it("pages from 1 when only perPage is sent", async () => {
    seedLocations(76);

    const body = await get("&perPage=20");

    expect(body.locations).toHaveLength(20);
    expect(body).toMatchObject({ page: 1, perPage: 20, totalPages: 4 });
  });

  it("uses 50 per page when only page is sent", async () => {
    seedLocations(76);

    const body = await get("&page=1");

    expect(body.locations).toHaveLength(50);
    expect(body).toMatchObject({ page: 1, perPage: 50, totalPages: 2 });
  });

  it("still caps perPage at 100", async () => {
    seedLocations(150);

    const body = await get("&page=1&perPage=500");

    expect(body.locations).toHaveLength(100);
    expect(body).toMatchObject({ perPage: 100, totalPages: 2 });
  });

  it("falls back to the first page when the requested page cannot be reached", async () => {
    seedLocations(76);

    const body = await get("&page=99999999999999999999&perPage=50");

    expect(body.locations[0]?.id).toBe("room-1");
    expect(body).toMatchObject({ page: 1, perPage: 50 });
  });
});
