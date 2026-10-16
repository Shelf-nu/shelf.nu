/**
 * The endpoint behind the detail pages' previous/next arrows. The arrows read
 * `data.prev` / `data.next` from it, so this pins that shape, that the
 * caller needs read access to the list it asks about, and that every failure
 * comes back as data rather than a thrown response.
 *
 * @see {@link file://../../../app/routes/api+/list-neighbours.ts}
 * @see {@link file://../../../app/components/layout/header/record-navigation.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { ShelfError } from "~/utils/error";

const requirePermission = vi.hoisted(() => vi.fn());
const fetchPageIds = vi.hoisted(() => vi.fn());
const createPageFetcher = vi.hoisted(() => vi.fn());
const sendNotification = vi.hoisted(() => vi.fn());

// why: a refused or stale lookup must not toast; the arrows already show it
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification,
}));

// why: the permission gate is under test only as "was it asked, and does a
// refusal stop the lookup"; its matrix is tested in @shelf/permissions
vi.mock("~/utils/roles.server", () => ({ requirePermission }));

// why: the list queries are each index's own; the route only has to route
// to them and stitch their ids
vi.mock("~/modules/list-navigation/registry.server", () => ({
  LIST_NAVIGATION_REGISTRY: {
    asset: {
      permissionEntity: "asset",
      indexPath: "/assets",
      createPageFetcher,
    },
    booking: {
      permissionEntity: "booking",
      indexPath: "/bookings",
      createPageFetcher,
    },
    kit: { permissionEntity: "kit", indexPath: "/kits", createPageFetcher },
    location: {
      permissionEntity: "location",
      indexPath: "/locations",
      createPageFetcher,
    },
  },
}));

const { loader } = await import("~/routes/api+/list-neighbours");

/** Calls the loader with `query` and returns its status and body. */
async function load(query: string) {
  const result = (await loader(
    createLoaderArgs({
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      request: new Request(`http://localhost/api/list-neighbours?${query}`),
    })
  )) as unknown as { data: unknown; init?: { status?: number } | null };
  return { status: result.init?.status ?? 200, body: result.data };
}

const PAGES: Record<string, string[]> = {
  "1": ["b1", "b2"],
  "2": ["b3", "b4"],
  "3": ["b5"],
};

describe("GET /api/list-neighbours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ organizationId: "org-1" });
    createPageFetcher.mockResolvedValue(fetchPageIds);
    fetchPageIds.mockImplementation(
      async ({ filters }: { filters: string }) =>
        PAGES[new URLSearchParams(filters).get("page") ?? ""] ?? []
    );
  });

  it("answers with both neighbours, crossing page boundaries", async () => {
    const filters = encodeURIComponent("?status=RESERVED&page=2");
    const { status, body } = await load(
      `entity=booking&id=b3&filters=${filters}`
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      prev: { id: "b2", page: 1 },
      next: { id: "b4", page: 2 },
    });
    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        entity: "booking",
        action: "read",
      })
    );
    expect(createPageFetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: { organizationId: "org-1", userId: "user-1" },
      })
    );
    expect(fetchPageIds).toHaveBeenCalledWith(
      expect.objectContaining({ filters: "status=RESERVED&page=1" })
    );
  });

  it("answers with no neighbours when the record is not in the list", async () => {
    const { status, body } = await load("entity=kit&id=gone&filters=page%3D2");

    expect(status).toBe(200);
    expect(body).toMatchObject({ prev: null, next: null });
  });

  it("returns the refusal when the caller may not read the list", async () => {
    requirePermission.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You do not have permission",
        label: "Permission",
        status: 403,
      })
    );

    const { status, body } = await load("entity=location&id=l1");

    expect(status).toBe(403);
    expect(body).toHaveProperty("error");
    expect(createPageFetcher).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("answers 400 for a list that has no arrows", async () => {
    const { status } = await load("entity=user&id=u1");

    expect(status).toBe(400);
    expect(requirePermission).not.toHaveBeenCalled();
  });
});
