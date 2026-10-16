/**
 * The asset page's delete refuses a request that did not type the asset's
 * title, the server half of the typed confirmation in `DeleteAsset`. A tab
 * opened before the dialog asked for the title, or a direct POST, deletes
 * nothing.
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.tsx}
 * @see {@link file://../../../app/utils/delete-confirmation.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

const mocks = vi.hoisted(() => ({
  findAsset: vi.fn(),
  deleteAsset: vi.fn(),
  deleteOtherImages: vi.fn(),
}));

// why: the permission gate is not under test; it lets the delete intent through
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: no database in tests; the delete reads only the asset's title
vi.mock("~/database/db.server", () => ({
  db: { asset: { findFirst: mocks.findAsset } },
}));

// why: the delete itself is covered by the service tests; here only whether
// the route calls it is observed. The typed-confirmation check stays real,
// reading the mocked database above.
vi.mock("~/modules/asset/service.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteAsset: mocks.deleteAsset,
  deleteOtherImages: mocks.deleteOtherImages,
}));

// why: the success toast goes through an SSE emitter that is not set up here
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the route's modules report through Sentry at import and on error;
// no reporting is under test
vi.mock("@sentry/react-router", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// why: the route transitively imports the scanner success animation, and
// lottie-web touches canvas APIs at import that happy-dom does not provide
vi.mock("lottie-react", () => ({ default: () => null }));

const { action } = await import("~/routes/_layout+/assets.$assetId");

/**
 * Posts the delete intent with `fields`.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
async function submitDelete(fields: Record<string, string>) {
  const response = await action(
    createActionArgs({
      params: { assetId: "asset-1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      request: new Request("http://localhost/assets/asset-1", {
        method: "POST",
        body: new URLSearchParams({ intent: "delete", ...fields }),
      }),
    })
  );
  return response as unknown as Response & { init?: { status?: number } };
}

/** The HTTP status of an action result, whether a Response or `data()`. */
function statusOf(result: Response & { init?: { status?: number } }) {
  return result.init?.status ?? result.status;
}

describe("asset page delete: typed title", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAsset.mockResolvedValue({ title: "Demo Camera" });
  });

  it("refuses a delete posted without the title, deleting nothing", async () => {
    const result = await submitDelete({});

    expect(statusOf(result)).toBe(400);
    expect(mocks.deleteAsset).not.toHaveBeenCalled();
  });

  it("refuses a different title", async () => {
    const result = await submitDelete({ confirmation: "Demo" });

    expect(statusOf(result)).toBe(400);
    expect(mocks.deleteAsset).not.toHaveBeenCalled();
  });

  it("deletes when the title is typed, in any case", async () => {
    const result = await submitDelete({ confirmation: "  demo camera " });

    expect(mocks.deleteAsset).toHaveBeenCalledWith({
      organizationId: "org-1",
      id: "asset-1",
      actorUserId: "user-1",
    });
    expect(statusOf(result)).toBe(302);
  });

  it("scopes the title lookup to the caller's workspace", async () => {
    await submitDelete({ confirmation: "Demo Camera" });

    expect(mocks.findAsset).toHaveBeenCalledWith({
      where: { id: "asset-1", organizationId: "org-1" },
      select: { title: true },
    });
  });
});
