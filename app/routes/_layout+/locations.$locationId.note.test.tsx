import { describe, expect, it, vi, beforeEach } from "vitest";

import type {
  action as actionType,
  loader as loaderType,
} from "./locations.$locationId.note";
import { action, loader } from "./locations.$locationId.note";

const requirePermissionMock = vi.hoisted(() => vi.fn());
const createLocationNoteMock = vi.hoisted(() => vi.fn());
const deleteLocationNoteMock = vi.hoisted(() => vi.fn());
const sendNotificationMock = vi.hoisted(() => vi.fn());
const locationFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock("~/modules/location-note/service.server", () => ({
  createLocationNote: createLocationNoteMock,
  deleteLocationNote: deleteLocationNoteMock,
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: sendNotificationMock,
}));

vi.mock("~/database/db.server", () => ({
  db: {
    location: {
      findUnique: locationFindUniqueMock,
    },
  },
}));

describe("locations.$locationId.note route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationFindUniqueMock.mockResolvedValue({
      organizationId: "org-1",
    });
  });

  it("redirects loader to the activity tab", () => {
    const response = loader({
      params: { locationId: "loc-1" },
      request: new Request("https://example.com"),
      context: { getSession: () => ({ userId: "user-1" }) },
    } as unknown as Parameters<typeof loaderType>[0]);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/locations/loc-1/activity");
  });

  it("creates a location note for authorized users", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
    });
    createLocationNoteMock.mockResolvedValue({ id: "note-1" });

    const request = new Request("https://example.com", {
      method: "POST",
      body: new URLSearchParams({ content: "HVAC serviced" }),
    });

    const response = await action({
      context: { getSession: () => ({ userId: "user-1" }) },
      request,
      params: { locationId: "loc-1" },
    } as unknown as Parameters<typeof actionType>[0]);

    expect(response.status).toBe(200);
    expect(createLocationNoteMock).toHaveBeenCalledWith({
      content: "HVAC serviced",
      locationId: "loc-1",
      userId: "user-1",
    });
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Note created" })
    );
  });

  it("deletes a location note for the author", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
    });

    const request = new Request("https://example.com", {
      method: "DELETE",
      body: new URLSearchParams({ noteId: "note-1" }),
    });

    const response = await action({
      context: { getSession: () => ({ userId: "user-1" }) },
      request,
      params: { locationId: "loc-1" },
    } as unknown as Parameters<typeof actionType>[0]);

    expect(response.status).toBe(200);
    expect(deleteLocationNoteMock).toHaveBeenCalledWith({
      id: "note-1",
      userId: "user-1",
    });
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Note deleted" })
    );
  });

  it("returns an error payload when permission check fails", async () => {
    requirePermissionMock.mockRejectedValue(new Error("forbidden"));

    const request = new Request("https://example.com", {
      method: "POST",
      body: new URLSearchParams({ content: "HVAC serviced" }),
    });

    const response = await action({
      context: { getSession: () => ({ userId: "user-1" }) },
      request,
      params: { locationId: "loc-1" },
    } as unknown as Parameters<typeof actionType>[0]);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).not.toBeNull();
  });
});
