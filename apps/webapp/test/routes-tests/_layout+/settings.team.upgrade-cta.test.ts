/**
 * Route tests for the Team settings loader's Personal-workspace upgrade CTA.
 *
 * `resolveTeamUpgradeCta` only formats a decision; the decision itself — is
 * this user entitled to a Team workspace — is made here, from the tier limit
 * and the premium-features flag. That makes this the surface where a wrong
 * answer reaches a user, so it is the surface worth pinning.
 *
 * A wrong answer is not cosmetic. `/account-details/subscription` redirects to
 * account settings when premium features are disabled, and its action refuses
 * a second free trial — so each of the cases below is a CTA that would land
 * somebody on a page that cannot do what the button promised.
 *
 * @see {@link file://../../../app/routes/_layout+/settings.team.tsx}
 * @see {@link file://../../../app/utils/team-upgrade-cta.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { getUserTierLimit } from "~/modules/tier/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { requirePermission } from "~/utils/roles.server";

// why: the CTA is about entitlement, not authorization — run the loader
// without executing real permission checks.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: both reads hit Prisma; the loader only needs their shape.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));
vi.mock("~/modules/tier/service.server", () => ({
  getUserTierLimit: vi.fn(),
}));

// why: `cookies.server` transitively imports `asset/utils.server`, which
// initializes Prisma at import time and leaves an unhandled connection error in
// the run. Mocking `parse` also lets the dismissal be set per test without
// encoding how the cookie is stored.
const cookiesMock = vi.hoisted(() => ({
  userPrefs: { parse: vi.fn(async () => ({}) as Record<string, unknown>) },
}));
vi.mock("~/utils/cookies.server", () => cookiesMock);

// why: `premiumIsEnabled` is read at module scope from config, so the flag has
// to be mocked rather than set. `vi.stubEnv` would be too late.
const subscriptionMock = vi.hoisted(() => ({ premiumIsEnabled: true }));
vi.mock("~/utils/subscription.server", () => subscriptionMock);

let loader: (typeof import("~/routes/_layout+/settings.team"))["loader"];

const requirePermissionMock = vi.mocked(requirePermission);
const getUserByIDMock = vi.mocked(getUserByID);
const getUserTierLimitMock = vi.mocked(getUserTierLimit);

beforeAll(async () => {
  ({ loader } = await import("~/routes/_layout+/settings.team"));
});

describe("app/routes/_layout+/settings.team loader — upgrade CTA", () => {
  const context = {
    getSession: () => ({ userId: "user-123" }),
  } as LoaderFunctionArgs["context"];

  beforeEach(() => {
    vi.clearAllMocks();
    subscriptionMock.premiumIsEnabled = true;
    cookiesMock.userPrefs.parse.mockResolvedValue({});
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      currentOrganization: { type: "PERSONAL", name: "My workspace" },
    } as any);
    getUserByIDMock.mockResolvedValue({ usedFreeTrial: false } as any);
    getUserTierLimitMock.mockResolvedValue({ maxOrganizations: 1 } as any);
  });

  async function runLoader() {
    // `payload()` returns the plain object (`{ error: null, ...data }`), not a
    // Response, so the loader's result is read directly.
    return (await loader(
      createLoaderArgs({
        request: new Request("http://localhost:3000/settings/team"),
        context,
      })
    )) as Record<string, unknown>;
  }

  it("offers the trial to a free user who is not yet entitled", async () => {
    const payload = await runLoader();

    expect(payload.upgradeCtaLabel).toBe("Start a Team trial");
    expect(payload.upgradeCtaTo).toBe("/account-details/subscription");
  });

  it("offers an upgrade, never a second trial, once the trial is spent", async () => {
    getUserByIDMock.mockResolvedValue({ usedFreeTrial: true } as any);

    const payload = await runLoader();

    expect(payload.upgradeCtaLabel).toBe("Upgrade to Team");
  });

  it("sends an entitled user to workspace creation", async () => {
    // tier_2 allows 2 organizations: the Personal one plus a Team one.
    getUserTierLimitMock.mockResolvedValue({ maxOrganizations: 2 } as any);

    const payload = await runLoader();

    expect(payload.upgradeCtaTo).toBe("/account-details/workspace");
    expect(payload.upgradeCtaLabel).toBe("Create a Team workspace");
  });

  it("stays on creation for an entitled user who already spent a trial", async () => {
    // Entitlement outranks the trial flag. A paying Team customer must never
    // be routed to billing for something they already have.
    getUserTierLimitMock.mockResolvedValue({ maxOrganizations: 2 } as any);
    getUserByIDMock.mockResolvedValue({ usedFreeTrial: true } as any);

    const payload = await runLoader();

    expect(payload.upgradeCtaTo).toBe("/account-details/workspace");
  });

  it("sends a self-hosted user to workspace creation, not to billing", async () => {
    // With premium features off nothing is gated, and the subscription route
    // redirects to account settings — so a trial CTA is a dead end even
    // though the tier limit still reads as the free default.
    subscriptionMock.premiumIsEnabled = false;
    getUserTierLimitMock.mockResolvedValue({ maxOrganizations: 1 } as any);

    const payload = await runLoader();

    expect(payload.upgradeCtaTo).toBe("/account-details/workspace");
    expect(payload.upgradeCtaLabel).toBe("Create a Team workspace");
  });

  it("reports the banner as open when no preference is stored", async () => {
    await expect(runLoader()).resolves.toMatchObject({
      upgradeBannerCollapsed: false,
    });
  });

  it("carries a stored fold through to the page", async () => {
    cookiesMock.userPrefs.parse.mockResolvedValue({
      teamUpgradeBannerCollapsed: true,
    });

    await expect(runLoader()).resolves.toMatchObject({
      upgradeBannerCollapsed: true,
    });
  });

  it("resolves no CTA work for a Team workspace", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      currentOrganization: { type: "TEAM", name: "Acme" },
    } as any);

    const payload = await runLoader();

    expect(payload.isPersonalOrg).toBe(false);
    // The tier is nobody's business on a Team workspace — not read at all.
    expect(getUserTierLimitMock).not.toHaveBeenCalled();
  });
});
