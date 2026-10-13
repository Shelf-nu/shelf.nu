/**
 * Settings hierarchy: the layout admits a member who can see at least one
 * tab, and every settings page keeps its own gate, so reaching a page by URL
 * is decided by that page, not by which tabs are visible.
 *
 * Runs the REAL layout, index and child loaders with only the organization
 * context and the database stubbed. A child that passes its gate goes on to
 * touch the stubbed database, which records that it was reached; a child that
 * refuses throws 403 first. Anything else (a crash before the gate, a 400, a
 * 500 that never reached the database) fails the test rather than counting
 * as "allowed".
 *
 * @see {@link file://../../../app/routes/_layout+/settings.tsx}
 * @see {@link file://../../../app/utils/permissions/settings-tabs.ts}
 */
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

const state = vi.hoisted(() => ({
  roles: [] as string[],
  type: "TEAM" as "TEAM" | "PERSONAL",
  /** Set by the database stub: the loader got past its permission gate. */
  dbReached: false,
}));

// why: the organization context reads the session cookie and the database; the
// membership under test is supplied here, everything above it is real
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(async () => ({
    organizationId: "org-1",
    organizations: [],
    userOrganizations: [{ organization: { id: "org-1" }, roles: state.roles }],
    currentOrganization: {
      id: "org-1",
      name: "Org",
      type: state.type,
      selfServiceCanSeeBookings: false,
      baseUserCanSeeBookings: false,
      selfServiceCanSeeCustody: false,
      baseUserCanSeeCustody: false,
      barcodesEnabled: false,
      auditsEnabled: false,
    },
    cookieRefreshNeeded: false,
  })),
}));

// why: past its gate a child loader reads the database. The stub records that it
// was reached and then stops the loader, which is how the test proves the gate
// was passed rather than inferring it from "some error that wasn't a 403".
// Symbol keys and `then` are answered with `undefined` so that inspecting or
// awaiting the client does not count as a query.
vi.mock("~/database/db.server", () => ({
  db: new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key === "symbol" || key === "then") return undefined;
        state.dbReached = true;
        throw new Error("database reached");
      },
    }
  ),
}));

// why: Stripe is initialised at import by billing helpers some settings pages import
vi.mock("~/utils/stripe.server", () => ({
  premiumIsEnabled: false,
  getOwnerSubscriptionInfo: vi.fn(),
  userHasActiveSubscription: vi.fn(),
}));

// why: Sentry scope tagging in requirePermission and error capture on a refused
// loader are irrelevant here
vi.mock("@sentry/react-router", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { loader as assetModels } from "~/routes/_layout+/settings.asset-models.index";
import { loader as bookings } from "~/routes/_layout+/settings.bookings";
import { loader as customFields } from "~/routes/_layout+/settings.custom-fields.index";
import { loader as emails } from "~/routes/_layout+/settings.emails";
import { loader as general } from "~/routes/_layout+/settings.general";
import { loader as index } from "~/routes/_layout+/settings.index";
import { loader as layout } from "~/routes/_layout+/settings";
import { loader as team } from "~/routes/_layout+/settings.team";
import { loader as teamInvites } from "~/routes/_layout+/settings.team.invites";
import { loader as teamNrm } from "~/routes/_layout+/settings.team.nrm";
import { loader as teamUsers } from "~/routes/_layout+/settings.team.users";

const args = () =>
  createLoaderArgs({
    request: new Request("http://localhost/settings"),
    context: { getSession: () => ({ userId: "user-1" }) } as never,
  });

/** The tab paths the Settings layout hands its component. */
async function layoutTabs(): Promise<string[]> {
  const res = (await layout(args() as never)) as { tabs: { to: string }[] };
  return res.tabs.map((t) => t.to);
}

/**
 * "denied" on a 403. "allowed" when the loader returned (data or redirect) or
 * provably got past its gate (it reached the database stub). Any other error is
 * rethrown, so a crash before authorization fails the test instead of passing
 * a positive assertion.
 */
async function gate(run: (a: never) => unknown) {
  state.dbReached = false;
  try {
    await run(args() as never);
    return "allowed";
  } catch (e) {
    const status =
      (e as { init?: { status?: number } }).init?.status ??
      (e as Response).status;
    if (status === 403) return "denied";
    if (state.dbReached) return "allowed";
    throw e;
  }
}

const CHILDREN = {
  general,
  bookings,
  emails,
  customFields,
  assetModels,
  team,
  teamUsers,
  teamInvites,
  teamNrm,
};

/**
 * Runs every child loader one after another: the database flag is shared, so
 * concurrent runs could credit one loader with another's query.
 */
async function childOutcomes() {
  const outcomes: Record<string, string> = {};
  for (const [name, run] of Object.entries(CHILDREN)) {
    outcomes[name] = await gate(run);
  }
  return outcomes;
}

describe("settings hierarchy", () => {
  beforeEach(() => {
    state.type = "TEAM";
  });

  it.each([["OWNER"], ["ADMIN"], ["SELF_SERVICE", "ADMIN"]])(
    "%s: layout lists every tab and every child admits",
    async (...roles) => {
      state.roles = roles;
      expect(await layoutTabs()).toEqual([
        "general",
        "bookings",
        "emails",
        "custom-fields",
        "asset-models",
        "team",
      ]);
      const outcomes = await childOutcomes();
      for (const outcome of Object.values(outcomes)) {
        expect(outcome).toBe("allowed");
      }
    }
  );

  it.each([["SELF_SERVICE"], ["BASE"]])(
    "%s: the layout refuses",
    async (role) => {
      state.roles = [role];
      expect(await gate(layout)).toBe("denied");
    }
  );

  it.each([["SELF_SERVICE"], ["BASE"]])(
    "%s: each child keeps its own gate when reached directly",
    async (role) => {
      state.roles = [role];
      expect(await childOutcomes()).toEqual({
        general: "denied",
        bookings: "denied",
        emails: "denied",
        customFields: "denied",
        // BASE holds assetModel:read; the page is reachable read-only by URL
        // while the layout still refuses it.
        assetModels: role === "BASE" ? "allowed" : "denied",
        team: "denied",
        teamUsers: "denied",
        teamInvites: "denied",
        teamNrm: "denied",
      });
    }
  );

  it("/settings redirects to the first visible tab", async () => {
    state.roles = ["ADMIN"];
    const res = (await index(args() as never)) as Response;
    expect(res.headers.get("Location")).toBe("/settings/general");
  });

  it("/settings refuses a member who may see no tab", async () => {
    state.roles = ["BASE"];
    expect(await gate(index)).toBe("denied");
  });

  it("a personal workspace hides Bookings and Emails", async () => {
    state.roles = ["OWNER"];
    state.type = "PERSONAL";
    expect(await layoutTabs()).toEqual([
      "general",
      "custom-fields",
      "asset-models",
      "team",
    ]);
  });
});
