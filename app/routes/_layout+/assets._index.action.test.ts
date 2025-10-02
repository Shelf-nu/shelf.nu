import { describe, expect, it, beforeEach, vi } from "vitest";

import type { DataOrErrorResponse } from "~/utils/http.server";

import { action } from "./assets._index";

const createPresetMock = vi.hoisted(() => vi.fn());
const renamePresetMock = vi.hoisted(() => vi.fn());
const deletePresetMock = vi.hoisted(() => vi.fn());
const listPresetsForUserMock = vi.hoisted(() => vi.fn());
const bulkDeleteAssetsMock = vi.hoisted(() => vi.fn());
const requirePermissionMock = vi.hoisted(() => vi.fn());
const sendNotificationMock = vi.hoisted(() => vi.fn());

let savedFiltersEnabled = true;

vi.mock("lottie-web", () => ({
  default: { loadAnimation: vi.fn() },
}));

vi.mock("lottie-web/build/player/lottie", () => ({
  default: {},
}));

vi.mock("lottie-react", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("~/utils/env", async () => {
  const actual = (await vi.importActual("~/utils/env")) as any;

  return {
    ...actual,
    get ENABLE_SAVED_ASSET_FILTERS() {
      return savedFiltersEnabled;
    },
  };
});

vi.mock("~/modules/asset-filter-presets/service.server", () => ({
  createPreset: createPresetMock,
  renamePreset: renamePresetMock,
  deletePreset: deletePresetMock,
  listPresetsForUser: listPresetsForUserMock,
}));

vi.mock("~/modules/asset/service.server", () => ({
  bulkDeleteAssets: bulkDeleteAssetsMock,
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: sendNotificationMock,
}));

vi.mock("~/database/db.server", () => ({
  db: {},
}));

function createRequest(form: Record<string, string | string[]>) {
  const params = new URLSearchParams();
  Object.entries(form).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((val) => params.append(key, val));
    } else {
      params.append(key, value);
    }
  });
  return new Request("http://localhost/assets", {
    method: "POST",
    body: params,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("assets index action", () => {
  const context = {
    getSession() {
      return { userId: "user-1" };
    },
  } as any;

  beforeEach(() => {
    savedFiltersEnabled = true;
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue({ organizationId: "org-1" });
    listPresetsForUserMock.mockResolvedValue([]);
  });

  it("creates a preset and returns the refreshed list", async () => {
    listPresetsForUserMock.mockResolvedValueOnce([
      {
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Morning",
        query: "status=AVAILABLE",
        view: "TABLE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const response = await action({
      context,
      params: {},
      request: createRequest({
        intent: "create-preset",
        name: "Morning",
        query: "status=AVAILABLE",
        view: "table",
      }),
    } as any);

    const payload = (await response.json()) as DataOrErrorResponse<{
      savedFilterPresets: unknown[];
    }>;

    expect(createPresetMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerId: "user-1",
      name: "Morning",
      query: "status=AVAILABLE",
      view: "table",
    });
    expect(listPresetsForUserMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerId: "user-1",
    });
    expect(payload.error).toBeNull();
    if ("savedFilterPresets" in payload) {
      expect(payload.savedFilterPresets).toHaveLength(1);
    } else {
      throw new Error("Expected savedFilterPresets in payload");
    }
  });

  it("renames a preset and returns the refreshed list", async () => {
    listPresetsForUserMock.mockResolvedValueOnce([
      {
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Updated",
        query: "status=AVAILABLE",
        view: "TABLE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const response = await action({
      context,
      params: {},
      request: createRequest({
        intent: "rename-preset",
        presetId: "preset-1",
        name: "Updated",
      }),
    } as any);

    const payload = (await response.json()) as DataOrErrorResponse<{
      savedFilterPresets: unknown[];
    }>;

    expect(renamePresetMock).toHaveBeenCalledWith({
      id: "preset-1",
      organizationId: "org-1",
      ownerId: "user-1",
      name: "Updated",
    });
    if ("savedFilterPresets" in payload) {
      expect(payload.savedFilterPresets).toHaveLength(1);
    } else {
      throw new Error("Expected savedFilterPresets in payload");
    }
  });

  it("deletes a preset and returns the refreshed list", async () => {
    listPresetsForUserMock.mockResolvedValueOnce([]);

    const response = await action({
      context,
      params: {},
      request: createRequest({
        intent: "delete-preset",
        presetId: "preset-1",
      }),
    } as any);

    await response.json();

    expect(deletePresetMock).toHaveBeenCalledWith({
      id: "preset-1",
      organizationId: "org-1",
      ownerId: "user-1",
    });
    expect(listPresetsForUserMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerId: "user-1",
    });
  });

  it("returns 404 when saved filters feature is disabled", async () => {
    savedFiltersEnabled = false;

    const response = await action({
      context,
      params: {},
      request: createRequest({
        intent: "create-preset",
        name: "Test",
        query: "status=AVAILABLE",
        view: "table",
      }),
    } as any);

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error).toBeTruthy();
  });
});
