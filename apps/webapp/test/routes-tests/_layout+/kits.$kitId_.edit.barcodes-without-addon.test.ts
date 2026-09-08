/**
 * Kit edit route — barcodes are left alone when the workspace has no add-on.
 *
 * `updateKit` reconciles the barcode list it is given against the barcodes on
 * the kit and deletes whatever is missing from that list. A workspace without
 * the alternative-barcodes add-on submits no barcode fields at all (the form
 * hides the section), so the action must hand `updateKit` no list rather than
 * an empty one: barcode rows survive an add-on lapse and are back the moment
 * the add-on is switched on again.
 *
 * @see {@link file://./../../../app/routes/_layout+/kits.$kitId_.edit.tsx}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { action } from "~/routes/_layout+/kits.$kitId_.edit";

// why: the route pulls the kit and asset service graphs (Prisma client,
// Supabase storage, permissions); stubbing at the module boundary keeps this a
// unit test of what the action hands to updateKit.
vi.mock("~/modules/kit/service.server", () => ({
  getKit: vi.fn().mockResolvedValue({ id: "kit-1", locationId: null }),
  updateKit: vi.fn().mockResolvedValue({ id: "kit-1" }),
  updateKitImage: vi.fn().mockResolvedValue(undefined),
  updateKitLocation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/modules/asset/service.server", () => ({
  getCategoriesForCreateAndEdit: vi.fn(),
  getLocationsForCreateAndEdit: vi.fn(),
}));
// why: permission resolution is an auth/network boundary, not the unit here.
// It is also where the add-on entitlement (`canUseBarcodes`) comes from, so
// each test states it explicitly.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import { updateKit } from "~/modules/kit/service.server";
import { requirePermission } from "~/utils/roles.server";

/**
 * Builds the action args for a plain save of the kit's core fields.
 *
 * why: happy-dom drops empty FormData fields on the Request round-trip, so the
 * body is built as URLSearchParams (see the repo note on that behaviour).
 */
function buildArgs(fields: Record<string, string> = {}) {
  const body = new URLSearchParams({
    name: "A kit",
    description: "",
    ...fields,
  });

  const request = new Request("http://localhost/kits/kit-1/edit", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return {
    request,
    params: { kitId: "kit-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0];
}

/** The single payload the action handed to `updateKit`. */
function updateKitPayload() {
  expect(updateKit).toHaveBeenCalledTimes(1);
  return vi.mocked(updateKit).mock.calls[0][0];
}

describe("kits.$kitId_.edit — barcodes without the add-on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateKit).mockResolvedValue({ id: "kit-1" } as never);
  });

  it("hands updateKit no barcode list when the workspace lacks the add-on", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      canUseBarcodes: false,
    } as never);

    await action(buildArgs());

    expect(updateKitPayload().barcodes).toBeUndefined();
  });

  it("passes the submitted barcodes when the workspace has the add-on", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      canUseBarcodes: true,
    } as never);

    await action(
      buildArgs({
        "barcodes[0].type": "Code39",
        "barcodes[0].value": "KIT001",
      })
    );

    expect(updateKitPayload().barcodes).toEqual([
      { type: "Code39", value: "KIT001" },
    ]);
  });
});
