/**
 * account-details.general action — updateFormatPrefs intent test
 *
 * Verifies the settings action parses the four concrete format-preference
 * fields and forwards them to updateUser with the caller's id.
 *
 * @see {@link file://./account-details.general.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { refreshAccessToken } from "~/modules/auth/service.server";
import * as userService from "~/modules/user/service.server";
import * as rolesServer from "~/utils/roles.server";
import { sendEmail } from "~/emails/mail.server";
import {
  assertEmailChangeAllowed,
  SSO_EMAIL_CHANGE_REFUSED_MESSAGE,
} from "~/modules/auth/sso-enforcement.server";
import { ShelfError } from "~/utils/error";

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

// why: the SSO decision behind an email change has its own tests
// (sso-enforcement.server.test.ts); here only whether the action asks it before
// starting the change matters. The message constant stays real.
vi.mock("~/modules/auth/sso-enforcement.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/modules/auth/sso-enforcement.server")
    >();
  return {
    SSO_EMAIL_CHANGE_REFUSED_MESSAGE: actual.SSO_EMAIL_CHANGE_REFUSED_MESSAGE,
    assertEmailChangeAllowed: vi.fn(),
  };
});

// why: the SSO domain list for the new-email schema is read from auth.sso_domains.
vi.mock("~/utils/sso.server", () => ({
  getConfiguredSSODomains: vi.fn().mockResolvedValue([]),
}));

const { mockGenerateLink, mockVerifyOtp, mockSignOut, mockGetSupabaseAdmin } =
  vi.hoisted(() => {
    const mockGenerateLink = vi.fn();
    const mockVerifyOtp = vi.fn();
    const mockSignOut = vi.fn();
    return {
      mockGenerateLink,
      mockVerifyOtp,
      mockSignOut,
      mockGetSupabaseAdmin: vi.fn(
        (_options?: { clientIp?: string | null }) => ({
          auth: {
            verifyOtp: mockVerifyOtp,
            admin: { generateLink: mockGenerateLink, signOut: mockSignOut },
          },
        })
      ),
    };
  });
// why: starting and confirming an email change are Supabase Auth network
// calls; the spies record whether the change was started and which visitor
// address the client was built with.
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: mockGetSupabaseAdmin,
}));

// why: refreshing the session after an email change is a Supabase call; the
// test asserts on what it is handed.
vi.mock("~/modules/auth/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/auth/service.server")>()),
  refreshAccessToken: vi.fn(),
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
    // Typed rather than `as never`: the deleteUser branch reads nothing off
    // this result, but `as never` would also accept a shape that no longer
    // matches if `requirePermission` changes. `as unknown as` is still needed
    // because this is a deliberate partial — the branch under test does not
    // touch the other fields.
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.OWNER,
    } as unknown as Awaited<ReturnType<typeof rolesServer.requirePermission>>);
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

describe("account-details.general action - initiateEmailChange SSO guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({} as never);
    vi.mocked(userService.getUserByID).mockResolvedValue({
      id: "user-1",
      email: "member@sso-corp.com",
    } as never);
    // A taken address ends the action right after the code request, without
    // rendering the verification email.
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { code: "email_exists", message: "taken" },
    });
  });

  /** POSTs an email change to `newEmail` for the signed-in member. */
  async function requestEmailChange(newEmail: string) {
    const body = new URLSearchParams({
      intent: "initiateEmailChange",
      type: "initiateEmailChange",
      email: newEmail,
      confirmEmail: newEmail,
    });

    return (await action(
      createActionArgs({
        request: new Request("http://localhost/account-details/general", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        }),
        context: {
          getSession: () => ({
            userId: "user-1",
            email: "member@sso-corp.com",
          }),
        } as never,
      })
    )) as unknown as {
      data: { error?: { message: string } };
      init?: { status?: number };
    };
  }

  it("refuses a standard account that must sign in with SSO", async () => {
    vi.mocked(assertEmailChangeAllowed).mockRejectedValue(
      new ShelfError({
        cause: null,
        status: 403,
        message: SSO_EMAIL_CHANGE_REFUSED_MESSAGE,
        label: "Auth",
        shouldBeCaptured: false,
      })
    );

    const result = await requestEmailChange("member@personal.com");

    expect(assertEmailChangeAllowed).toHaveBeenCalledWith({
      userId: "user-1",
      email: "member@sso-corp.com",
    });
    expect(result.init?.status).toBe(403);
    expect(result.data.error?.message).toBe(SSO_EMAIL_CHANGE_REFUSED_MESSAGE);
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("starts the change for an allowed account", async () => {
    vi.mocked(assertEmailChangeAllowed).mockResolvedValue(undefined);

    await requestEmailChange("member@personal.com");

    expect(mockGenerateLink).toHaveBeenCalledWith({
      type: "email_change_new",
      email: "member@sso-corp.com",
      newEmail: "member@personal.com",
    });
  });
});

describe("account-details.general action: verifyEmailChange visitor address", () => {
  const VISITOR_IP = "203.0.113.7";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({} as never);
    vi.mocked(assertEmailChangeAllowed).mockResolvedValue(undefined);
    vi.mocked(userService.getUserByID).mockResolvedValue({
      id: "user-1",
    } as never);
    mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
    mockSignOut.mockResolvedValue({ error: null });
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: "new-access-token",
    } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the visitor's address to Supabase for the code check and the refresh", async () => {
    // why: a self-hosted instance with one proxy in front, so the proxy's
    // X-Forwarded-For entry names the visitor.
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const body = new URLSearchParams({
      intent: "verifyEmailChange",
      type: "verifyEmailChange",
      email: "member@personal.com",
      otp: "123456",
    });

    await action(
      createActionArgs({
        request: new Request("http://localhost/account-details/general", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Forwarded-For": VISITOR_IP,
          },
          body: body.toString(),
        }),
        context: {
          getSession: () => ({
            userId: "user-1",
            email: "member@example.com",
            refreshToken: "refresh-token",
          }),
          setSession: vi.fn(),
        } as never,
      })
    );

    // Supabase counts its per-IP limits against the visitor, not this server.
    expect(mockGetSupabaseAdmin).toHaveBeenCalledWith({
      clientIp: VISITOR_IP,
    });
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "member@personal.com",
      token: "123456",
      type: "email_change",
    });
    expect(refreshAccessToken).toHaveBeenCalledWith("refresh-token", {
      clientIp: VISITOR_IP,
    });
  });
});
