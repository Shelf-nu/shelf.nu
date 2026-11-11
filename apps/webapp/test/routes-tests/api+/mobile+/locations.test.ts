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
  locations: Array<{ id: string; name: string }>;
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

/** A workspace with `n` locations, already in name order. */
function seedLocations(n: number) {
  const all = Array.from({ length: n }, (_, i) => ({
    id: `loc-${i + 1}`,
    name: `Room ${String(i + 1).padStart(4, "0")}`,
    description: null,
    image: null,
    parentId: null,
  }));

  vi.mocked(db.location.findMany).mockImplementation(((args?: {
    skip?: number;
    take?: number;
  }) => {
    const skip = args?.skip ?? 0;
    const end = args?.take === undefined ? undefined : skip + args.take;
    return Promise.resolve(all.slice(skip, end));
  }) as unknown as typeof db.location.findMany);
  vi.mocked(db.location.count).mockResolvedValue(n);
}

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
    expect(body.locations.at(-1)?.id).toBe("loc-76");
    expect(body).toMatchObject({ page: 1, totalCount: 76, totalPages: 1 });
  });

  it("returns every match for a search", async () => {
    seedLocations(120);

    const body = await get("&search=room");

    expect(body.locations).toHaveLength(120);
    expect(body.totalPages).toBe(1);
  });

  it("stops at the hard cap and reports the remaining pages", async () => {
    seedLocations(1500);

    const body = await get();

    expect(body.locations).toHaveLength(1000);
    expect(body).toMatchObject({
      page: 1,
      perPage: 1000,
      totalCount: 1500,
      totalPages: 2,
    });
  });
});

describe("GET /api/mobile/locations: paged requests", () => {
  it("returns the requested page", async () => {
    seedLocations(76);

    const body = await get("&page=2&perPage=50");

    expect(body.locations).toHaveLength(26);
    expect(body.locations[0]?.id).toBe("loc-51");
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
});
