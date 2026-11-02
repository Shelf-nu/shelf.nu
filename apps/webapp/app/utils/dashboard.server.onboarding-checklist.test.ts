/**
 * Tests for {@link resolveOnboardingChecklist}: when the home page shows the
 * onboarding checklist, and when that checklist offers the spreadsheet import.
 *
 * The import lookup runs through the real `subscription.server` helpers, so a
 * failed lookup is checked end to end: it must read as "cannot import", never
 * take the home page down.
 *
 * @see {@link file://./dashboard.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTierLimit } = vi.hoisted(() => ({ mockTierLimit: vi.fn() }));

// why: the plan lookup reads the workspace owner's tier from the database.
vi.mock("~/modules/tier/service.server", () => ({
  getOrganizationTierLimit: mockTierLimit,
  getUserTierLimit: vi.fn(),
}));

// why: imported by the modules under test; no case here may reach the database.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the plan gate only applies when premium features are on.
vi.mock("~/config/shelf.config", async (importOriginal) => {
  const actual = await importOriginal<{ config: Record<string, unknown> }>();
  return { config: { ...actual.config, enablePremiumFeatures: true } };
});

// why: the logger reports to Sentry; a failed lookup is expected to log.
vi.mock("~/utils/logger", () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { resolveOnboardingChecklist } from "./dashboard.server";

/** A brand new workspace: nothing on the checklist is done. */
const nothingDone = {
  hasAssets: false,
  hasCustodies: false,
  hasTeamMembers: false,
  hasTags: false,
  hasCategories: false,
  hasCustomFields: false,
};

const importEligibility = {
  organizationId: "org-1",
  organizations: [],
  userId: "user-1",
  role: "ADMIN" as const,
};

/** Runs the helper for a checklist state and a skip flag. */
function resolve(
  checklistOptions: typeof nothingDone,
  skipOnboardingChecklist = false
) {
  return resolveOnboardingChecklist({
    checklistOptions,
    skipOnboardingChecklist,
    importEligibility,
  });
}

describe("resolveOnboardingChecklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTierLimit.mockResolvedValue({ canImportAssets: true });
  });

  it("offers the import on a fresh workspace whose plan and role allow it", async () => {
    await expect(resolve(nothingDone)).resolves.toEqual({
      showsChecklist: true,
      canImportAssets: true,
    });
  });

  it("does not offer it on a plan without importing", async () => {
    mockTierLimit.mockResolvedValue({ canImportAssets: false });

    await expect(resolve(nothingDone)).resolves.toEqual({
      showsChecklist: true,
      canImportAssets: false,
    });
  });

  it("drops the import once the workspace has an asset, without a lookup", async () => {
    await expect(resolve({ ...nothingDone, hasAssets: true })).resolves.toEqual(
      { showsChecklist: true, canImportAssets: false }
    );
    expect(mockTierLimit).not.toHaveBeenCalled();
  });

  it("hides the checklist and skips the lookup when the member skipped it", async () => {
    await expect(resolve(nothingDone, true)).resolves.toEqual({
      showsChecklist: false,
      canImportAssets: false,
    });
    expect(mockTierLimit).not.toHaveBeenCalled();
  });

  it("hides the checklist once every item is done", async () => {
    const allDone = Object.fromEntries(
      Object.keys(nothingDone).map((key) => [key, true])
    ) as typeof nothingDone;

    await expect(resolve(allDone)).resolves.toEqual({
      showsChecklist: false,
      canImportAssets: false,
    });
  });

  it("reads a failed lookup as cannot import, keeping the checklist up", async () => {
    mockTierLimit.mockRejectedValue(new Error("db down"));

    await expect(resolve(nothingDone)).resolves.toEqual({
      showsChecklist: true,
      canImportAssets: false,
    });
  });
});
