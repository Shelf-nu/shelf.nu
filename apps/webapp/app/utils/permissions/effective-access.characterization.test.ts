/**
 * Effective-access characterization: pins every role decision that has a pure
 * helper to a committed fixture.
 *
 * A failure here means a role decision changed. If the change is an intended
 * behaviour change, update the fixture in the same commit with
 * `pnpm webapp:test -- --run <this file> -u` and name the change in the commit
 * body. Otherwise it is a regression: fix the code, not the fixture.
 *
 * @see {@link file://./effective-access.probes.ts}
 */

// why: the probed helpers live in modules that import the database client at
// module load; the probes never query, so an empty client keeps the import pure
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: roles.server imports the organization context, which pulls in Stripe
// and the mailer; the probed functions never call it
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
}));

// why: resolveCalendarVisibility's module imports the bookings entitlement
// helpers, which load the user and tier services; the probes never call them
vi.mock("~/utils/subscription.server", () => ({
  canUseBookings: vi.fn(),
  assertCanUseBookings: vi.fn(),
}));

import {
  ROLE_SETS,
  buildEffectiveAccessSnapshot,
} from "./effective-access.probes";

// @vitest-environment node

describe("effective access", () => {
  it("matches the committed fixture", async () => {
    await expect(
      `${JSON.stringify(buildEffectiveAccessSnapshot(), null, 2)}\n`
    ).toMatchFileSnapshot("./__snapshots__/effective-access.json");
  });

  it("records every role set in every mixed-role probe", () => {
    const roleSetKeys = ROLE_SETS.map((roles) =>
      roles.length ? roles.join("+") : "(none)"
    );
    const snapshot = buildEffectiveAccessSnapshot();
    const mixedRoleKeys = Object.keys(snapshot).filter((k) =>
      /^B[89]:/.test(k)
    );

    expect(mixedRoleKeys.length).toBeGreaterThanOrEqual(59);
    for (const probeKey of mixedRoleKeys) {
      expect(
        Object.keys(snapshot[probeKey] as Record<string, unknown>),
        probeKey
      ).toEqual(roleSetKeys);
    }
  });
});
