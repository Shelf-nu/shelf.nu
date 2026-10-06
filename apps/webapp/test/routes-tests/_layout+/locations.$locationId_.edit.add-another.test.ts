/**
 * Location edit route: where "Add another" goes.
 *
 * The shared location form renders "Add another" on both the create and the edit
 * page, and its tooltip promises "Save the location and add a new one". The
 * button only keeps that promise if the action it posts to acts on the flag, so
 * this pins the edit action's destination against the create-page behaviour and
 * against the asset edit route, which answers the same question the same way.
 *
 * @see {@link file://./../../../app/routes/_layout+/locations.$locationId_.edit.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/locations.$locationId_.edit";

// why: the route reaches Prisma, Supabase storage and the permission resolver;
// stubbing at the module boundary keeps this a unit test of the redirect choice.
vi.mock("~/modules/location/service.server", () => ({
  getLocation: vi.fn(),
  updateLocation: vi.fn(),
  updateLocationImage: vi.fn(),
}));
vi.mock("~/modules/asset/service.server", () => ({
  getLocationsForCreateAndEdit: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import {
  updateLocation,
  updateLocationImage,
} from "~/modules/location/service.server";
import { requirePermission } from "~/utils/roles.server";

/**
 * Builds the action args for a save.
 *
 * why: happy-dom drops empty FormData fields on the Request round-trip, so the
 * body is built as URLSearchParams.
 */
function buildArgs(overrides: Record<string, string> = {}) {
  const body = new URLSearchParams({
    name: "Shelf B2",
    description: "",
    address: "",
    ...overrides,
  });

  const request = new Request("http://localhost/locations/location-1/edit", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return {
    request,
    params: { locationId: "location-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0];
}

describe("locations.$locationId_.edit: addAnother", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
    } as never);
    vi.mocked(updateLocation).mockResolvedValue({
      id: "location-1",
      name: "Shelf B2",
    } as never);
    vi.mocked(updateLocationImage).mockResolvedValue(undefined as never);
  });

  it("sends the user to a blank create form", async () => {
    const response = await action(buildArgs({ addAnother: "true" }));

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("location")).toBe(
      "/locations/new"
    );
  });

  it("saves the edit before navigating away", async () => {
    await action(buildArgs({ addAnother: "true" }));

    expect(updateLocation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "location-1", name: "Shelf B2" })
    );
  });

  it("outranks redirectTo, which describes where the user came from", async () => {
    const response = await action(
      buildArgs({ addAnother: "true", redirectTo: "/locations" })
    );

    expect((response as Response).headers.get("location")).toBe(
      "/locations/new"
    );
  });

  it("honours redirectTo when the plain Save button was used", async () => {
    const response = await action(buildArgs({ redirectTo: "/locations" }));

    expect((response as Response).headers.get("location")).toBe("/locations");
  });

  it("stays on the page when neither was asked for", async () => {
    const response = await action(buildArgs());

    // A plain save answers with data, not a redirect, so a save opened in a new
    // tab does not navigate.
    expect(response).not.toBeInstanceOf(Response);
  });
});
