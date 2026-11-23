/**
 * Admin user route: the "Link subscriptions to workspaces" form
 * (`linkSubscriptionToWorkspace` intent), which links one of the viewed
 * user's Stripe subscriptions to a Team workspace they own, and the admin
 * gate in front of it.
 *
 * @see {@link file://./../../../../app/routes/_layout+/admin-dashboard+/$userId.tsx}
 * @see {@link file://./../../../../app/modules/stripe-webhook/helpers.server.ts} linkSubscriptionToWorkspaceAsAdmin
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/admin-dashboard+/$userId";
import { ShelfError } from "~/utils/error";

// why: the route's component tree imports lottie, which draws on a canvas at
// import time; happy-dom has no canvas.
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

// why: the route module imports Prisma; this intent never reaches it directly.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: requireAdmin reads the caller's roles from the database.
vi.mock("~/utils/roles.server", () => ({
  requireAdmin: vi.fn(),
}));

// why: the helper writes to Stripe; it is tested on its own in
// helpers.server.test.ts. Here only the hand-off from the form is checked.
vi.mock("~/modules/stripe-webhook/helpers.server", () => ({
  linkSubscriptionToWorkspaceAsAdmin: vi.fn(),
}));

// why: notifications go over a server-sent event emitter.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the route answers failures with react-router's data(), which returns a
// DataWithResponseInit rather than a Response; mocking it to a real Response
// lets the status be asserted, as the other route tests do.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: createDataMock(),
}));

import { linkSubscriptionToWorkspaceAsAdmin } from "~/modules/stripe-webhook/helpers.server";
import { requireAdmin } from "~/utils/roles.server";

/** The admin driving the page. */
const ADMIN_ID = "admin-1";
/** The user whose page is open. */
const VIEWED_USER_ID = "user-1";

/**
 * Builds action args posting `fields` to the viewed user's admin page.
 *
 * why: a URLSearchParams body, because happy-dom drops empty FormData fields
 * on the Request round-trip.
 */
function actionArgs(fields: Record<string, string>) {
  return {
    request: new Request(`http://localhost/admin-dashboard/${VIEWED_USER_ID}`, {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    params: { userId: VIEWED_USER_ID },
    context: { getSession: () => ({ userId: ADMIN_ID }) },
  } as unknown as Parameters<typeof action>[0];
}

describe("admin user route: linkSubscriptionToWorkspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: ADMIN_ID } as never);
  });

  it("links the subscription for the viewed user, not the admin", async () => {
    await action(
      actionArgs({
        intent: "linkSubscriptionToWorkspace",
        subscriptionId: "sub_1",
        organizationId: "org-2",
      })
    );

    expect(linkSubscriptionToWorkspaceAsAdmin).toHaveBeenCalledWith({
      userId: VIEWED_USER_ID,
      subscriptionId: "sub_1",
      organizationId: "org-2",
    });
  });

  it("refuses a request without a workspace", async () => {
    const response = (await action(
      actionArgs({
        intent: "linkSubscriptionToWorkspace",
        subscriptionId: "sub_1",
        organizationId: "",
      })
    )) as unknown as Response;

    expect(response.status).toBe(400);
    expect(linkSubscriptionToWorkspaceAsAdmin).not.toHaveBeenCalled();
  });

  it("passes the helper's refusal back to the form", async () => {
    vi.mocked(linkSubscriptionToWorkspaceAsAdmin).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Pick a Team workspace this user owns.",
        label: "Stripe webhook",
        status: 400,
      })
    );

    const response = (await action(
      actionArgs({
        intent: "linkSubscriptionToWorkspace",
        subscriptionId: "sub_1",
        organizationId: "org-other",
      })
    )) as unknown as Response;

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(
      "Pick a Team workspace this user owns."
    );
  });

  it("is closed to non-admins", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Not an admin",
        label: "Permission",
        status: 403,
      })
    );

    const response = (await action(
      actionArgs({
        intent: "linkSubscriptionToWorkspace",
        subscriptionId: "sub_1",
        organizationId: "org-2",
      })
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(linkSubscriptionToWorkspaceAsAdmin).not.toHaveBeenCalled();
  });
});
