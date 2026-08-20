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
import { sendEmail } from "~/emails/mail.server";

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

// why: the deleteUser intent sends two real emails; these are also the sinks
// the recipient assertions are made against.
vi.mock("~/emails/mail.server", () => ({
  sendEmail: vi.fn(),
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

describe("account-details.general action — deleteUser recipients", () => {
  /**
   * The confirmation email used `parsedData.email` — a form field validated
   * only as `z.string()` — as its `to:` address. Any authenticated user could
   * therefore make Shelf send a Shelf-branded email, from Shelf's sending
   * domain, to an address of their choosing: a spam relay borrowing our
   * deliverability reputation.
   *
   * detail.dev finding D061.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({} as never);
  });

  /** POSTs a deletion request claiming `claimedEmail` in the form body. */
  async function requestDeletion(claimedEmail: string) {
    const body = new URLSearchParams({
      intent: "deleteUser",
      type: "deleteUser",
      email: claimedEmail,
      reason: "no longer needed",
    });

    await action(
      createActionArgs({
        request: new Request("http://localhost/account-details/general", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        }),
        context: {
          getSession: () => ({ userId: "user-1", email: "owner@example.com" }),
        } as never,
      })
    );
  }

  it("never sends to an address supplied by the form", async () => {
    await requestDeletion("victim@example.com");

    const recipients = vi.mocked(sendEmail).mock.calls.map(([args]) => args.to);

    // The attacker-chosen address must not appear as a recipient at all.
    expect(recipients).not.toContain("victim@example.com");
  });

  it("sends the confirmation to the SESSION's address", async () => {
    await requestDeletion("victim@example.com");

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        subject: "Delete account request received",
      })
    );
  });

  it("reports the SESSION's address to the admin, not the claimed one", async () => {
    // The admin notification is where a human reviews the request, so showing
    // it an address the account does not own is its own problem.
    await requestDeletion("victim@example.com");

    const adminCall = vi
      .mocked(sendEmail)
      .mock.calls.find(([args]) => args.subject === "Delete account request");

    expect(adminCall?.[0].text).toContain("owner@example.com");
    expect(adminCall?.[0].text).not.toContain("victim@example.com");
  });
});
