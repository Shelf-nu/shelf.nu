import { describe, expect, it, vi } from "vitest";

async function loadSubscriptionModule(enablePremium: boolean) {
  vi.resetModules();
  vi.doMock("~/modules/tier/service.server", () => ({
    getOrganizationTierLimit: vi.fn(),
    getUserTierLimit: vi.fn(),
  }));
  vi.doMock("~/modules/custom-field/service.server", () => ({
    countActiveCustomFields: vi.fn(),
  }));
  vi.doMock("~/modules/user/service.server", () => ({
    getUserByID: vi.fn(),
  }));
  vi.doMock("~/database/db.server", () => ({
    db: {},
  }));

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
