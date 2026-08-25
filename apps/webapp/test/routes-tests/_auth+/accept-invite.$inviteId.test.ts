/**
 * Accept-invite route — the displayed invite must be the accepted invite.
 *
 * The loader renders the organization name from the URL's `inviteId`. The
 * action used to accept whatever invite the JWT in the form body named, and
 * nothing tied the two together. So a crafted link could show one workspace
 * and join another:
 *
 *   /accept-invite/<invite-the-victim-trusts>?token=<attacker's own invite>
 *
 * `updateInviteStatus` performs no session check — it acts purely on the id it
 * is given, then the route signs the browser in as that invite's
 * `inviteeEmail`. So an unauthenticated victim accepting a swapped token lands
 * in the ATTACKER's account, not merely the wrong organization.
 *
 * Every legitimately-generated link signs the same id it puts in the path
 * (`jwt.sign({ id: invite.id })` alongside `/accept-invite/${invite.id}` in
 * both `invite-template.tsx` and `helpers.ts`), so requiring equality cannot
 * break a real invite — pinned by the happy-path test below.
 *
 * detail.dev finding D070.
 *
 * @see {@link file://./../../../app/routes/_auth+/accept-invite.$inviteId.tsx}
 */

// why: preventing Prisma from trying to connect to a real database during tests
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: mocking Remix's data() so the action's error path returns a readable
// Response rather than an internal payload object
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: acceptance is the sink under test — assert it is never reached, and
// never actually mutate an invite
vi.mock("~/modules/invite/service.server", () => ({
  updateInviteStatus: vi.fn(),
  checkUserAndInviteMatch: vi.fn(),
}));

// why: external auth — no Supabase in tests. Returning null takes the
// "already registered" branch, which redirects without touching a session.
vi.mock("~/modules/auth/service.server", () => ({
  signInWithEmail: vi.fn().mockResolvedValue(null),
}));

// why: only sets a cookie header on the success path
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("org-cookie"),
}));

import { updateInviteStatus } from "~/modules/invite/service.server";
import { action } from "~/routes/_auth+/accept-invite.$inviteId";
// The real secret, stubbed by test/setup-test-env.ts — signing with the same
// value the route verifies with keeps this a test of the id check, not of JWT.
import { INVITE_TOKEN_SECRET } from "~/utils/env";
import jwt from "~/utils/jsonwebtoken.server";

// @vitest-environment node

/** Signs a token naming `inviteId`, exactly as `inviteUser` does. */
function tokenFor(inviteId: string, secret: string = INVITE_TOKEN_SECRET) {
  return jwt.sign({ id: inviteId }, secret, { expiresIn: "7d" });
}

/** Invokes the action for `/accept-invite/:inviteId` with a token in the body. */
function accept({ inviteId, token }: { inviteId: string; token: string }) {
  return action({
    request: new Request(`https://app.shelf.nu/accept-invite/${inviteId}`, {
      method: "POST",
      body: new URLSearchParams({ token }),
    }),
    params: { inviteId },
    context: {
      isAuthenticated: false,
      getSession: () => ({ userId: "user-1" }),
      setSession: vi.fn(),
    },
  } as unknown as Parameters<typeof action>[0]);
}

describe("accept-invite action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (updateInviteStatus as any).mockResolvedValue({
      status: "ACCEPTED",
      organizationId: "org-1",
      inviteeEmail: "invitee@example.com",
    });
  });

  it("refuses a token naming a different invite than the URL", async () => {
    // The victim sees the organization behind `trusted-invite`; the token
    // would have joined them to the attacker's.
    await accept({
      inviteId: "trusted-invite",
      token: tokenFor("attacker-invite"),
    });

    // The assertion that matters: acceptance never happens.
    expect(updateInviteStatus).not.toHaveBeenCalled();
  });

  it("does not echo the invite the token named", async () => {
    const result = await accept({
      inviteId: "trusted-invite",
      token: tokenFor("attacker-invite"),
    });

    expect(await (result as unknown as Response).text()).not.toContain(
      "attacker-invite"
    );
  });

  it("accepts when the token names the invite in the URL", async () => {
    // Every real link signs the same id it puts in the path, so this is the
    // shape all genuine invites take.
    await accept({ inviteId: "real-invite", token: tokenFor("real-invite") });

    expect(updateInviteStatus).toHaveBeenCalledTimes(1);
    expect((updateInviteStatus as any).mock.calls[0][0]).toMatchObject({
      id: "real-invite",
    });
  });

  it("still rejects a token signed with the wrong secret", async () => {
    await accept({
      inviteId: "real-invite",
      token: tokenFor("real-invite", "not-the-secret"),
    });

    expect(updateInviteStatus).not.toHaveBeenCalled();
  });
});
