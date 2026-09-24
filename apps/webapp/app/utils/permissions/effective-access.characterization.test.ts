/**
 * Effective-access characterization: pins every role decision that has a pure
 * helper to a committed fixture.
 *
 * A failure here means a role decision changed. If the change is one of the
 * listed fixes (spec section 8.3 / 8.5), update the fixture in the same commit
 * with `pnpm webapp:test -- --run <this file> -u` and say why in the commit
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

import { buildEffectiveAccessSnapshot } from "./effective-access.probes";

// @vitest-environment node

describe("effective access", () => {
  it("matches the committed fixture", async () => {
    await expect(
      `${JSON.stringify(buildEffectiveAccessSnapshot(), null, 2)}\n`
    ).toMatchFileSnapshot("./__snapshots__/effective-access.json");
  });
});
