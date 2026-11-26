/**
 * Settings > Bookings action: the `updateBookingApproval` intent.
 *
 * The approval card posts two switches, one per requesting role. Each switch
 * must land on its own column (`requireApprovalForBase`,
 * `requireApprovalForSelfService`) through `updateBookingSettings`; a swap
 * would gate the wrong role's reservations. Any other intent, a missing one
 * or an unknown one never writes the approval columns, even when the switch
 * fields ride along in the form.
 *
 * @see {@link file://../../../app/routes/_layout+/settings.bookings.tsx}
 */
// @vitest-environment node
import { OrganizationRoles, OrganizationType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

// why: the permission lookup reads the session and the database
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: updateBookingSettings writes the workspace row; it is the sink whose
// input the route is judged on. The rest of the module is database-backed.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
  updateAlwaysNotifyTeamMembers: vi.fn(),
  updateBookingSettings: vi.fn(),
}));

// why: notifications go through an event emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: `db.server` connects at module load; the other services the route
// imports reach it, and none of them runs for these intents
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: Stripe is initialised at import by billing helpers
vi.mock("~/utils/stripe.server", () => ({
  premiumIsEnabled: false,
  getOwnerSubscriptionInfo: vi.fn(),
  userHasActiveSubscription: vi.fn(),
}));

import { updateBookingSettings } from "~/modules/booking-settings/service.server";
import { action } from "~/routes/_layout+/settings.bookings";
import { requirePermission } from "~/utils/roles.server";

/** The session the route reads the acting user from. */
const mockContext = {
  getSession: () => ({ userId: "user-1" }),
} as never;

/**
 * POSTs `fields` to the settings action as an Admin of a team workspace.
 *
 * @param fields - The form fields, in submission order
 * @returns The action's `data()` result
 */
function post(fields: [string, string][]) {
  return action(
    createActionArgs({
      context: mockContext,
      request: new Request("http://localhost/settings/bookings", {
        method: "POST",
        body: new URLSearchParams(fields),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
      params: {},
    })
  ) as Promise<{ init?: { status?: number } | null }>;
}

describe("settings.bookings updateBookingApproval intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const context = permissionContext({ roles: [OrganizationRoles.ADMIN] });
    vi.mocked(requirePermission).mockResolvedValue({
      ...context,
      currentOrganization: {
        ...context.currentOrganization,
        type: OrganizationType.TEAM,
      },
    } as never);
    vi.mocked(updateBookingSettings).mockResolvedValue({} as never);
  });

  it("writes Base on and Self service off from their own switches", async () => {
    const result = await post([
      ["intent", "updateBookingApproval"],
      ["requireApprovalForBase", "on"],
    ]);

    expect(result.init?.status).toBe(200);
    expect(updateBookingSettings).toHaveBeenCalledTimes(1);
    expect(updateBookingSettings).toHaveBeenCalledWith({
      organizationId: "org-1",
      requireApprovalForBase: true,
      requireApprovalForSelfService: false,
    });
  });

  it("writes Base off and Self service on from their own switches", async () => {
    const result = await post([
      ["intent", "updateBookingApproval"],
      ["requireApprovalForSelfService", "on"],
    ]);

    expect(result.init?.status).toBe(200);
    expect(updateBookingSettings).toHaveBeenCalledTimes(1);
    expect(updateBookingSettings).toHaveBeenCalledWith({
      organizationId: "org-1",
      requireApprovalForBase: false,
      requireApprovalForSelfService: true,
    });
  });

  it("refuses a form with no intent and writes nothing", async () => {
    const result = await post([
      ["requireApprovalForBase", "on"],
      ["requireApprovalForSelfService", "on"],
    ]);

    expect(result.init?.status).not.toBe(200);
    expect(updateBookingSettings).not.toHaveBeenCalled();
  });

  it("refuses an unknown intent and writes nothing", async () => {
    const result = await post([
      ["intent", "updateBookingApprovals"],
      ["requireApprovalForBase", "on"],
      ["requireApprovalForSelfService", "on"],
    ]);

    expect(result.init?.status).not.toBe(200);
    expect(updateBookingSettings).not.toHaveBeenCalled();
  });

  it("leaves the approval columns alone on another settings intent", async () => {
    await post([
      ["intent", "updateTagsRequired"],
      ["tagsRequired", "on"],
      ["requireApprovalForBase", "on"],
      ["requireApprovalForSelfService", "on"],
    ]);

    expect(updateBookingSettings).toHaveBeenCalledTimes(1);
    const written = vi.mocked(updateBookingSettings).mock.calls[0]?.[0];
    expect(written).not.toHaveProperty("requireApprovalForBase");
    expect(written).not.toHaveProperty("requireApprovalForSelfService");
  });
});
