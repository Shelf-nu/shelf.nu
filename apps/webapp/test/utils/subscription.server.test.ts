import { describe, expect, it, vi } from "vitest";

/** Stand-in for the owner's tier lookup, re-created for every module load. */
let getOrganizationTierLimitMock = vi.fn();

/**
 * Loads a fresh copy of `subscription.server` with premium features on or off.
 * `premiumIsEnabled` is read once at import, so each case needs its own load.
 *
 * @param enablePremium - The `ENABLE_PREMIUM_FEATURES` value for this load
 * @param database - `"push"` backs the database with the in-memory push store;
 *   by default no query may run
 */
async function loadSubscriptionModule(
  enablePremium: boolean,
  database: "none" | "push" = "none"
) {
  vi.resetModules();
  getOrganizationTierLimitMock = vi.fn();
  // why: the tier lookup reads the workspace owner's tier from the database
  vi.doMock("~/modules/tier/service.server", () => ({
    getOrganizationTierLimit: getOrganizationTierLimitMock,
    getUserTierLimit: vi.fn(),
  }));
  // why: imported by the module under test; these cases never count fields
  vi.doMock("~/modules/custom-field/service.server", () => ({
    countActiveCustomFields: vi.fn(),
  }));
  // why: imported by the module under test; these cases never load a user
  vi.doMock("~/modules/user/service.server", () => ({
    getUserByID: vi.fn(),
  }));
  // why: no database in unit tests. The push store evaluates the tier query
  // the way Postgres would; otherwise an empty client fails any query.
  vi.doMock("~/database/db.server", async () => ({
    db:
      database === "push"
        ? (await import("@helpers/in-memory-push-db")).pushDb
        : {},
  }));

  // why: premium features are read once at import; each case picks its value
  vi.doMock("~/config/shelf.config", () => ({
    config: {
      enablePremiumFeatures: enablePremium,
    },
  }));

  const subscriptionModule = await import("~/utils/subscription.server");

  return subscriptionModule;
}

describe("canHideShelfBranding", () => {
  it("returns false when premium is enabled but the tier does not allow hiding", async () => {
    const { canHideShelfBranding } = await loadSubscriptionModule(true);

    expect(canHideShelfBranding({ canHideShelfBranding: false })).toBe(false);
  });

  it("returns true when premium is enabled and the tier allows hiding", async () => {
    const { canHideShelfBranding } = await loadSubscriptionModule(true);

    expect(canHideShelfBranding({ canHideShelfBranding: true })).toBe(true);
  });

  it("returns false when premium is enabled but the tier limit is missing", async () => {
    const { canHideShelfBranding } = await loadSubscriptionModule(true);

    expect(canHideShelfBranding(null)).toBe(false);
    expect(canHideShelfBranding(undefined)).toBe(false);
  });

  it("always returns true when premium features are disabled", async () => {
    const { canHideShelfBranding } = await loadSubscriptionModule(false);

    expect(canHideShelfBranding({ canHideShelfBranding: false })).toBe(true);
  });
});

describe("canUseBarcodes", () => {
  it("returns true when premium disabled (regardless of barcodesEnabled)", async () => {
    const { canUseBarcodes } = await loadSubscriptionModule(false);

    expect(canUseBarcodes({ barcodesEnabled: false })).toBe(true);
    expect(canUseBarcodes({ barcodesEnabled: true })).toBe(true);
  });

  it("returns true when premium enabled and barcodesEnabled is true", async () => {
    const { canUseBarcodes } = await loadSubscriptionModule(true);

    expect(canUseBarcodes({ barcodesEnabled: true })).toBe(true);
  });

  it("returns false when premium enabled and barcodesEnabled is false", async () => {
    const { canUseBarcodes } = await loadSubscriptionModule(true);

    expect(canUseBarcodes({ barcodesEnabled: false })).toBe(false);
  });
});

describe("canUseAudits", () => {
  it("returns true when premium disabled (regardless of auditsEnabled)", async () => {
    const { canUseAudits } = await loadSubscriptionModule(false);

    expect(canUseAudits({ auditsEnabled: false })).toBe(true);
    expect(canUseAudits({ auditsEnabled: true })).toBe(true);
  });

  it("returns true when premium enabled and auditsEnabled is true", async () => {
    const { canUseAudits } = await loadSubscriptionModule(true);

    expect(canUseAudits({ auditsEnabled: true })).toBe(true);
  });

  it("returns false when premium enabled and auditsEnabled is false", async () => {
    const { canUseAudits } = await loadSubscriptionModule(true);

    expect(canUseAudits({ auditsEnabled: false })).toBe(false);
  });
});

describe("resolveCanImportAssets", () => {
  const args = {
    organizationId: "org-1",
    organizations: [],
    userId: "user-1",
    role: "ADMIN" as const,
  };

  /** Loads the module with the tier answer the test needs. */
  async function load(canImportAssets: boolean) {
    const subscriptionModule = await loadSubscriptionModule(true);
    getOrganizationTierLimitMock.mockResolvedValue({ canImportAssets });
    return subscriptionModule;
  }

  it("is true when the plan allows importing and the role may import", async () => {
    const { resolveCanImportAssets } = await load(true);
    await expect(resolveCanImportAssets(args)).resolves.toBe(true);
  });

  it("is false on a plan without importing", async () => {
    const { resolveCanImportAssets } = await load(false);
    await expect(resolveCanImportAssets(args)).resolves.toBe(false);
  });

  it("is false for a role without the import permission", async () => {
    const { resolveCanImportAssets } = await load(true);
    await expect(
      resolveCanImportAssets({ ...args, role: "BASE" })
    ).resolves.toBe(false);
  });

  it.each([true, false])(
    "agrees with the import page's plan gate when the plan says %s",
    async (planAllows) => {
      const { resolveCanImportAssets, assertUserCanImportAssets } =
        await load(planAllows);
      const pageLetsIn = await assertUserCanImportAssets(args).then(
        () => true,
        () => false
      );

      await expect(resolveCanImportAssets(args)).resolves.toBe(pageLetsIn);
    }
  );
});

describe("resolveCanImportAssetsOrFalse", () => {
  const args = {
    organizationId: "org-1",
    organizations: [],
    userId: "user-1",
    role: "ADMIN" as const,
  };

  it("passes the answer through when the lookup succeeds", async () => {
    const { resolveCanImportAssetsOrFalse } =
      await loadSubscriptionModule(true);
    getOrganizationTierLimitMock.mockResolvedValue({ canImportAssets: true });

    await expect(resolveCanImportAssetsOrFalse(args)).resolves.toBe(true);
  });

  it("logs and reads a failed lookup as cannot import", async () => {
    const { resolveCanImportAssetsOrFalse } =
      await loadSubscriptionModule(true);
    const { Logger } = await import("~/utils/logger");
    // why: the logger reports to Sentry; the test only checks it was called
    const logError = vi.spyOn(Logger, "error").mockImplementation(() => {});
    getOrganizationTierLimitMock.mockRejectedValue(new Error("db down"));

    await expect(resolveCanImportAssetsOrFalse(args)).resolves.toBe(false);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe("canUseReports", () => {
  it("follows the plan's switch when premium is enabled", async () => {
    const { canUseReports } = await loadSubscriptionModule(true);

    expect(canUseReports({ canUseReports: true })).toBe(true);
    expect(canUseReports({ canUseReports: false })).toBe(false);
  });

  it("returns false when premium is enabled but the tier limit is missing", async () => {
    const { canUseReports } = await loadSubscriptionModule(true);

    expect(canUseReports(null)).toBe(false);
    expect(canUseReports(undefined)).toBe(false);
  });

  it("always returns true when premium features are disabled (self-hosted)", async () => {
    const { canUseReports } = await loadSubscriptionModule(false);

    expect(canUseReports({ canUseReports: false })).toBe(true);
    expect(canUseReports(null)).toBe(true);
  });
});

describe("workspaceCanUseReports and assertUserCanUseReports", () => {
  const args = {
    organizationId: "org-1",
    organizations: [
      {
        id: "org-1",
        type: "PERSONAL" as const,
        name: "Personal",
        imageId: null,
        userId: "owner-1",
      },
    ],
  };

  it("reads the workspace's plan, not the viewer's", async () => {
    const { workspaceCanUseReports } = await loadSubscriptionModule(true);
    getOrganizationTierLimitMock.mockResolvedValue({ canUseReports: true });

    await expect(workspaceCanUseReports(args)).resolves.toBe(true);
    expect(getOrganizationTierLimitMock).toHaveBeenCalledWith(args);
  });

  it("refuses a plan without reports with a 403 that names the plans", async () => {
    const { assertUserCanUseReports } = await loadSubscriptionModule(true);
    getOrganizationTierLimitMock.mockResolvedValue({ canUseReports: false });

    const refusal = await assertUserCanUseReports(args).catch(
      (cause: unknown) => cause
    );

    // `ShelfError.status` defaults to 500, so the 403 has to be set on purpose.
    expect(refusal).toMatchObject({
      status: 403,
      title: "Reports are part of Plus and Team",
      message:
        "Upgrade this workspace to open reports. Your assets and their data stay available on every plan.",
      shouldBeCaptured: false,
    });
  });

  it("lets a plan with reports through", async () => {
    const { assertUserCanUseReports } = await loadSubscriptionModule(true);
    getOrganizationTierLimitMock.mockResolvedValue({ canUseReports: true });

    await expect(assertUserCanUseReports(args)).resolves.toBeUndefined();
  });

  it("skips the tier lookup when premium features are disabled", async () => {
    const { workspaceCanUseReports, assertUserCanUseReports } =
      await loadSubscriptionModule(false);

    await expect(workspaceCanUseReports(args)).resolves.toBe(true);
    await expect(assertUserCanUseReports(args)).resolves.toBeUndefined();
    expect(getOrganizationTierLimitMock).not.toHaveBeenCalled();
  });
});

describe("filterOrganizationsWithPush", () => {
  it("keeps the workspaces whose owner's plan includes push, in their order, with one query", async () => {
    const { filterOrganizationsWithPush } = await loadSubscriptionModule(
      true,
      "push"
    );
    const { pushDb, pushStore, seedCustomTierLimit, seedOrganization } =
      await import("@helpers/in-memory-push-db");
    seedOrganization({ id: "org-free", userId: "owner-free" }, "free");
    seedOrganization({ id: "org-plus", userId: "owner-plus" }, "tier_1");
    seedOrganization({ id: "org-custom-on", userId: "owner-on" }, "custom");
    seedCustomTierLimit("owner-on", true);
    seedOrganization({ id: "org-custom-off", userId: "owner-off" }, "custom");
    seedCustomTierLimit("owner-off", false);
    // A custom tier without its limit row, and a tier without a limit row
    seedOrganization({ id: "org-no-custom", userId: "owner-none" }, "custom");
    seedOrganization({ id: "org-no-limit", userId: "owner-gone" }, "tier_2");
    pushStore.tierPush.delete("tier_2");
    const findMany = vi.spyOn(pushDb.organization, "findMany");

    const allowed = await filterOrganizationsWithPush([
      "org-custom-on",
      "org-free",
      "org-no-limit",
      "org-plus",
      "org-custom-off",
      "org-no-custom",
    ]);

    expect(allowed).toEqual(["org-custom-on", "org-plus"]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("returns every workspace without a query when premium features are disabled", async () => {
    const { filterOrganizationsWithPush } = await loadSubscriptionModule(false);

    await expect(
      filterOrganizationsWithPush(["org-free", "org-plus"])
    ).resolves.toEqual(["org-free", "org-plus"]);
  });
});
