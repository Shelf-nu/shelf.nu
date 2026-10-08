/**
 * The staff "new update" action reads the target-role checkboxes by the field
 * names the form posts (`targetAdmin`, `targetSelfService`, ...), so a form
 * rendered before a deploy keeps targeting the audience it shows.
 *
 * @see {@link file://../../../../app/routes/_layout+/admin-dashboard+/updates.new.tsx}
 * @see {@link file://../../../../app/modules/update/audience.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";
import { createUpdate } from "~/modules/update/service.server";

// why: the staff gate reads the user row from the database; it is not under
// test, so it lets the request through
vi.mock("~/utils/roles.server", () => ({
  requireAdmin: vi.fn(async () => undefined),
}));

// why: the write is the observable outcome; the test asserts what the
// service receives instead of persisting an update
vi.mock("~/modules/update/service.server", () => ({
  createUpdate: vi.fn(async () => ({ id: "update-1" })),
}));

// why: the publish date is parsed in the acting user's stored timezone, which
// is a database read; UTC keeps the parse deterministic
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(async () => ({ timeZone: "UTC" })),
}));

// why: importing the route reaches `db.server`, which connects at module
// scope; every delegate the action uses is mocked above
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the route's modules report through Sentry at import and on error;
// no reporting is under test
vi.mock("@sentry/react-router", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { action } = await import(
  "~/routes/_layout+/admin-dashboard+/updates.new"
);

describe("new update action: target roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("targets exactly the roles an already-open form checked", async () => {
    // why: a `URLSearchParams` body rather than `FormData`, which happy-dom
    // can alter on the `Request` round-trip
    const body = new URLSearchParams({
      title: "Maintenance window",
      content: "Tonight 22:00 UTC",
      publishDate: "2026-09-25T22:00",
      status: "DRAFT",
      targetAdmin: "on",
      targetSelfService: "on",
    });

    await action(
      createActionArgs({
        request: new Request(
          "https://app.shelf.nu/admin-dashboard/updates/new",
          { method: "POST", body }
        ),
        context: { getSession: () => ({ userId: "shelf-staff-1" }) } as never,
      })
    );

    expect(createUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ targetRoles: ["ADMIN", "SELF_SERVICE"] })
    );
  });

  it("targets everyone when no role is checked", async () => {
    const body = new URLSearchParams({
      title: "Maintenance window",
      content: "Tonight 22:00 UTC",
      publishDate: "2026-09-25T22:00",
      status: "DRAFT",
    });

    await action(
      createActionArgs({
        request: new Request(
          "https://app.shelf.nu/admin-dashboard/updates/new",
          { method: "POST", body }
        ),
        context: { getSession: () => ({ userId: "shelf-staff-1" }) } as never,
      })
    );

    expect(createUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ targetRoles: [] })
    );
  });
});
