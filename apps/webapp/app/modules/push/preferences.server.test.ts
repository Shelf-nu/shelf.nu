/**
 * Tests for reading a person's push switches.
 *
 * @see {@link file://./preferences.server.ts}
 */
import { resetPushStore } from "@helpers/in-memory-push-db";
import { getNotificationPreferences } from "./preferences.server";

// @vitest-environment node

// why: no database in unit tests; the in-memory store holds the preference rows
vi.mock("~/database/db.server", async () => ({
  db: (await import("@helpers/in-memory-push-db")).pushDb,
}));

beforeEach(() => {
  resetPushStore();
});

describe("getNotificationPreferences", () => {
  it("hands each caller its own copy of the defaults", async () => {
    const first = await getNotificationPreferences("user-1");
    first.bookings = false;

    const second = await getNotificationPreferences("user-2");

    expect(second).toEqual({
      pushEnabled: true,
      bookings: true,
      audits: true,
      stockAndReminders: true,
    });
  });
});
