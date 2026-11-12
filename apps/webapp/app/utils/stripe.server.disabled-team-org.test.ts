/**
 * `disabledTeamOrg` keeps the account-details pages reachable while a team
 * workspace without a team subscription is disabled. Only the URL's pathname
 * decides which page that is.
 *
 * Kept apart from `stripe.server.test.ts` because it needs premium features
 * switched on, which `stripe.server.ts` reads once at import.
 *
 * @see {@link file://./stripe.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "~/config/types";

// why: premium gating is read from the config once at import; these cases
// need it on.
vi.mock("~/config/shelf.config", async (importOriginal) => {
  const actual = await importOriginal<{ config: Config }>();
  return { config: { ...actual.config, enablePremiumFeatures: true } };
});
// why: the tier lookup is a database query; each case is a team workspace on
// the free tier, the state that disables it.
vi.mock("~/modules/tier/service.server", () => ({
  getOrganizationTierLimit: vi.fn(),
  updateUserTierId: vi.fn(),
}));
// why: importing the module loads ~/database/db.server, whose module-level
// connect rejects in a DB-less test env.
vi.mock("~/database/db.server", () => ({ db: {} }));

import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { disabledTeamOrg, isAccountDetailsUrl } from "./stripe.server";

const TEAM_ORG = { id: "org-team", type: "TEAM" as const };

/** Runs the check for a free-tier team workspace on the given URL. */
function checkUrl(url: string) {
  return disabledTeamOrg({
    currentOrganization: TEAM_ORG,
    organizations: [],
    url,
  });
}

describe("disabledTeamOrg", () => {
  beforeEach(() => {
    vi.mocked(getOrganizationTierLimit).mockResolvedValue({
      id: "free",
    } as never);
  });

  it("disables the workspace on an ordinary page", async () => {
    await expect(checkUrl("https://app.shelf.nu/assets")).resolves.toBe(true);
  });

  it.each([
    "https://app.shelf.nu/account-details",
    "https://app.shelf.nu/account-details/subscription",
    "https://app.shelf.nu/account-details/workspace/new?x=1",
    "https://app.shelf.nu/account-details.data",
    "/account-details/general",
  ])("keeps %s reachable", async (url) => {
    await expect(checkUrl(url)).resolves.toBe(false);
  });

  it.each([
    "https://app.shelf.nu/assets?account-details=1",
    "https://app.shelf.nu/assets?redirectTo=/account-details",
    "https://app.shelf.nu/assets#account-details",
    "https://app.shelf.nu/bookings/account-details",
    "https://app.shelf.nu/account-details-other",
  ])("does not exempt %s", async (url) => {
    await expect(checkUrl(url)).resolves.toBe(true);
  });
});

describe("isAccountDetailsUrl", () => {
  it("accepts a bare path as well as a full URL", () => {
    expect(isAccountDetailsUrl("/account-details")).toBe(true);
    expect(isAccountDetailsUrl("https://app.shelf.nu/account-details")).toBe(
      true
    );
  });

  it("reads only the pathname", () => {
    expect(isAccountDetailsUrl("/assets?account-details=1")).toBe(false);
  });
});
