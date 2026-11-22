// @vitest-environment node
/**
 * Loader tests for an asset's reminders tab.
 *
 * The page's loader tells the reminder dialog whether the workspace's plan
 * includes recurring reminders, so the Repeat control is offered or locked.
 * The flag follows the workspace owner's tier limit.
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.reminders.tsx}
 * @see {@link file://../../../app/utils/subscription.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";

// why: the permission gate reads the session's workspace from the database;
// it resolves the acting user's workspace directly
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({
    organizationId: "org-1",
    organizations: [
      {
        id: "org-1",
        type: "TEAM",
        name: "Team",
        imageId: null,
        userId: "owner-1",
      },
    ],
  })),
}));

// why: importing the route reaches `db.server`, which connects at module
// scope; every delegate the loader uses is mocked below
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: premium features are read once at import; the flag only follows the
// tier when they are on
vi.mock("~/config/shelf.config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/config/shelf.config")>();
  return { config: { ...actual.config, enablePremiumFeatures: true } };
});

// why: the reminder list is a paginated database query; an empty page is
// enough to reach the flag
vi.mock("~/modules/asset-reminder/service.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/asset-reminder/service.server")
  >()),
  getPaginatedAndFilterableReminders: vi.fn(async () => ({
    reminders: [],
    totalReminders: 0,
    page: 1,
    perPage: 20,
    totalPages: 0,
    search: null,
  })),
}));

// why: the workspace owner's tier is read from the database; each case picks it
vi.mock("~/modules/tier/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/tier/service.server")>()),
  getOrganizationTierLimit: vi.fn(),
}));

const { loader } = await import("~/routes/_layout+/assets.$assetId.reminders");

/** Runs the loader as a signed-in member of org-1. */
function load() {
  return loader(
    createLoaderArgs({
      params: { assetId: "asset-1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      request: new Request("http://localhost/assets/asset-1/reminders"),
    })
  );
}

describe("assets.$assetId.reminders loader recurring-reminders flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([true, false])(
    "returns canUseRecurringReminders=%s when the tier says so",
    async (allowed) => {
      vi.mocked(getOrganizationTierLimit).mockResolvedValue({
        canUseRecurringReminders: allowed,
      } as never);

      const result = await load();

      expect(result.canUseRecurringReminders).toBe(allowed);
      expect(getOrganizationTierLimit).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" })
      );
    }
  );

  it("returns false when the tier limit cannot be resolved", async () => {
    vi.mocked(getOrganizationTierLimit).mockResolvedValue(null as never);

    const result = await load();

    expect(result.canUseRecurringReminders).toBe(false);
  });
});
