/**
 * Notifications tab: reads the switches and whether push can reach the
 * person, and saves one switch at a time with server-side validation.
 *
 * @see {@link file://../../../app/routes/_layout+/account-details.notifications.tsx}
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import {
  pushStore,
  resetPushStore,
  seedOrganization,
  seedPreferences,
} from "@helpers/in-memory-push-db";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: the gate is observed, not executed; the permission matrix has its own
// tests. Each case picks the workspaces the person belongs to.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: no database in route tests; the in-memory store holds the preference
// rows and the owner tiers the tier check reads
vi.mock("~/database/db.server", async () => ({
  db: (await import("@helpers/in-memory-push-db")).pushDb,
}));

// why: a rejected save raises a toast through the notification emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const { action, loader } = await import(
  "~/routes/_layout+/account-details.notifications"
);

const ctx = { getSession: () => ({ userId: "user-1" }) } as never;

/** Lets the person belong to the given workspaces. */
function memberOf(...organizationIds: string[]) {
  vi.mocked(requirePermission).mockResolvedValue({
    organizations: organizationIds.map((id) => ({ id })),
  } as never);
}

/**
 * Submits one switch as the tab does.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
function submit(fields: Record<string, string>) {
  return action(
    createActionArgs({
      context: ctx,
      request: new Request("http://localhost/account-details/notifications", {
        method: "POST",
        body: new URLSearchParams(fields),
      }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPushStore();
  seedOrganization({ id: "org-free", userId: "owner-free" }, "free");
  seedOrganization({ id: "org-plus", userId: "owner-plus" }, "tier_1");
  memberOf("org-free", "org-plus");
});

describe("notifications tab loader", () => {
  it("reads every switch on, and push available through a paid workspace", async () => {
    const result = await loader(createLoaderArgs({ context: ctx }));

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.userData,
        action: PermissionAction.read,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        preferences: {
          pushEnabled: true,
          bookings: true,
          audits: true,
          stockAndReminders: true,
        },
        pushAvailable: true,
      })
    );
  });

  it("reports push unavailable when every workspace is on the free tier", async () => {
    memberOf("org-free");

    const result = await loader(createLoaderArgs({ context: ctx }));

    expect(result).toEqual(expect.objectContaining({ pushAvailable: false }));
  });
});

describe("notifications tab action", () => {
  it("saves the flipped switch and keeps the others", async () => {
    seedPreferences({ userId: "user-1", audits: false });

    const result = await submit({ preference: "bookings", enabled: "off" });

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.userData,
        action: PermissionAction.update,
      })
    );
    expect(result).toEqual({
      error: null,
      preferences: {
        pushEnabled: true,
        bookings: false,
        audits: false,
        stockAndReminders: true,
      },
    });
  });

  it("answers 400 with a field error for an unknown switch and saves nothing", async () => {
    const result = await submit({ preference: "marketing", enabled: "on" });

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(400);
    const { error } = result.data as DataOrErrorResponse;
    expect(getValidationErrors(error)?.preference?.message).toEqual(
      expect.any(String)
    );
    expect(pushStore.preferences).toEqual([]);
  });
});
