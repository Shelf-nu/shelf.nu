import { describe, expect, it, vi } from "vitest";

/** Stand-in for the owner's tier lookup, re-created for every module load. */
let getOrganizationTierLimitMock = vi.fn();

/**
 * Loads a fresh copy of `subscription.server` with premium features on or off.
 * `premiumIsEnabled` is read once at import, so each case needs its own load.
 *
 * @param enablePremium - The `ENABLE_PREMIUM_FEATURES` value for this load
 */
async function loadSubscriptionModule(enablePremium: boolean) {
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
  // why: no case here may reach the database
  vi.doMock("~/database/db.server", () => ({
    db: {},
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

describe("canUseRecurringReminders", () => {
  it("returns true when premium features are disabled, whatever the tier says", async () => {
    const { canUseRecurringReminders } = await loadSubscriptionModule(false);

    expect(canUseRecurringReminders({ canUseRecurringReminders: false })).toBe(
      true
    );
    expect(canUseRecurringReminders(null)).toBe(true);
  });

  it("returns false when premium is enabled but the tier limit is missing", async () => {
    const { canUseRecurringReminders } = await loadSubscriptionModule(true);

    expect(canUseRecurringReminders(null)).toBe(false);
    expect(canUseRecurringReminders(undefined)).toBe(false);
  });

  it("follows the tier flag when premium is enabled", async () => {
    const { canUseRecurringReminders } = await loadSubscriptionModule(true);

    expect(canUseRecurringReminders({ canUseRecurringReminders: false })).toBe(
      false
    );
    expect(canUseRecurringReminders({ canUseRecurringReminders: true })).toBe(
      true
    );
  });
});

describe("assertUserCanUseRecurringReminders", () => {
  const args = {
    organizationId: "org-1",
    organizations: [
      {
        id: "org-1",
        type: "TEAM" as const,
        name: "Team",
        imageId: null,
        userId: "owner-1",
      },
    ],
  };

  it("reads the workspace's plan through the owner's tier lookup", async () => {
    const { assertUserCanUseRecurringReminders } =
      await loadSubscriptionModule(true);
    getOrganizationTierLimitMock.mockResolvedValue({
      canUseRecurringReminders: true,
    });

    await expect(
      assertUserCanUseRecurringReminders(args)
    ).resolves.toBeUndefined();
    expect(getOrganizationTierLimitMock).toHaveBeenCalledWith(args);
  });

  it("refuses a plan without recurring reminders with an uncaptured 403", async () => {
    const { assertUserCanUseRecurringReminders } =
      await loadSubscriptionModule(true);
    getOrganizationTierLimitMock.mockResolvedValue({
      canUseRecurringReminders: false,
    });

    const refusal = await assertUserCanUseRecurringReminders(args).catch(
      (cause: unknown) => cause
    );

    expect(refusal).toMatchObject({
      status: 403,
      title: "Not allowed",
      shouldBeCaptured: false,
    });
  });

  it("refuses when the tier limit cannot be resolved", async () => {
    const { assertUserCanUseRecurringReminders } =
      await loadSubscriptionModule(true);
    getOrganizationTierLimitMock.mockResolvedValue(null);

    await expect(
      assertUserCanUseRecurringReminders(args)
    ).rejects.toMatchObject({ status: 403 });
  });

  it("lets every workspace through when premium features are disabled", async () => {
    const { assertUserCanUseRecurringReminders } =
      await loadSubscriptionModule(false);
    getOrganizationTierLimitMock.mockResolvedValue({
      canUseRecurringReminders: false,
    });

    await expect(
      assertUserCanUseRecurringReminders(args)
    ).resolves.toBeUndefined();
  });
});
