/**
 * account-details.general action — updateFormatPrefs intent test
 *
 * Verifies the settings action parses the four concrete format-preference
 * fields and forwards them to updateUser with the caller's id.
 *
 * @see {@link file://./account-details.general.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import * as userService from "~/modules/user/service.server";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/_layout+/account-details.general";

// @vitest-environment node

// why: isolate the action from the real permission check + DB write; we only
// assert the parse → updateUser wiring for the new intent.
vi.mock("~/modules/user/service.server", () => ({
  updateUser: vi.fn(),
  updateProfilePicture: vi.fn(),
  getUserByID: vi.fn(),
  getUserWithContact: vi.fn(),
  updateUserEmail: vi.fn(),
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: importing the route module transitively loads ~/database/db.server, whose
// module-level `void db.$connect()` rejects with P1001 in a DB-less test env and
// surfaces as an unhandled rejection. The updateFormatPrefs path only touches db
// through already-mocked services, so a bare stub is sufficient.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: sendNotification pushes to an SSE emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

describe("account-details.general action — updateFormatPrefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({} as never);
  });

  it("forwards the four concrete fields to updateUser", async () => {
    const body = new URLSearchParams({
      intent: "updateFormatPrefs",
      type: "updateFormatPrefs",
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "Europe/London",
    });

    const request = new Request("http://localhost/account-details/general", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const context = {
      getSession: () => ({
        userId: "user-1",
        email: "u@example.com",
      }),
    };

    await action(createActionArgs({ request, context: context as never }));

    expect(userService.updateUser).toHaveBeenCalledWith({
      id: "user-1",
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "Europe/London",
    });
  });
});
