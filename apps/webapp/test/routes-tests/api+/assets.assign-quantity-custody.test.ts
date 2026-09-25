/**
 * POST /api/assets/assign-quantity-custody, from the source-location angle.
 *
 * The route passes the "From location" choice through to `checkOutQuantity`
 * untouched (a location id, `"unplaced"` for the unplaced units, absent when the
 * dialog did not ask) and names the recorded source in the audit note for a
 * pool with two or more sources. The source rules themselves are the
 * service's and are tested there; the role gates are pinned here.
 *
 * @see {@link file://./../../../app/routes/api+/assets.assign-quantity-custody.ts}
 * @see {@link file://./../../../app/modules/asset/service.custody-source.test.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkOutQuantity } from "~/modules/asset/service.server";
import { createNote } from "~/modules/note/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { action } from "~/routes/api+/assets.assign-quantity-custody";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

// why: mocking Remix's data() so the action returns a real Response
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (data: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(data), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: the custody write and its source rules are the service's; this suite
// asserts what the route hands it and what it does with the answer
vi.mock("~/modules/asset/service.server", () => ({
  checkOutQuantity: vi.fn(),
}));

// why: authorization is resolved per test (ADMIN, SELF_SERVICE, BASE)
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the custodian lookup reads the database
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vi.fn(),
}));

// why: the audit note's actor lookup reads the database
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Ana",
    lastName: "Admin",
    displayName: null,
  }),
}));

// why: notes are asserted, not written
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn().mockResolvedValue({}),
}));

// why: the low-stock check sends notifications
vi.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vi.fn().mockResolvedValue(undefined),
}));

// why: preventing actual notification sending during route tests
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const mockCheckOut = vi.mocked(checkOutQuantity);

function asRole(role: OrganizationRoles) {
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    role,
  } as Awaited<ReturnType<typeof requirePermission>>);
}

function post(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request(
      "https://example.com/api/assets/assign-quantity-custody",
      { method: "POST", body: formData }
    ),
    params: {},
  } as unknown as ActionFunctionArgs;
}

const base = { assetId: "asset-1", teamMemberId: "tm-1", quantity: "2" };

beforeEach(() => {
  vi.clearAllMocks();
  asRole(OrganizationRoles.ADMIN);
  vi.mocked(getTeamMember).mockResolvedValue({
    id: "tm-1",
    name: "Ahmed",
    userId: "user-ahmed",
    user: { id: "user-ahmed", firstName: "Ahmed", lastName: "R" },
  } as never);
  mockCheckOut.mockResolvedValue({
    asset: { id: "asset-1" },
    source: {
      locationId: null,
      locationName: null,
      explicit: false,
      multiSource: false,
    },
  } as never);
});

describe("POST /api/assets/assign-quantity-custody", () => {
  it("forwards the chosen location, and the unplaced word for the unplaced units", async () => {
    // Form parsing drops empty strings, which is why the web posts a word.
    for (const locationId of ["loc-studio", "unplaced"]) {
      await action(post({ ...base, locationId }));
      expect(mockCheckOut).toHaveBeenLastCalledWith(
        expect.objectContaining({ locationId })
      );
    }
  });

  it("sends no location when the dialog did not ask (pool at one location)", async () => {
    await action(post(base));
    expect(mockCheckOut.mock.calls[0][0].locationId).toBeUndefined();
  });

  it("names the source in the note for a pool with several sources", async () => {
    mockCheckOut.mockResolvedValue({
      asset: { id: "asset-1" },
      source: {
        locationId: "loc-studio",
        locationName: "Studio",
        explicit: true,
        multiSource: true,
      },
    } as never);

    await action(post({ ...base, locationId: "loc-studio" }));

    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'from {% link to="/locations/loc-studio" text="Studio" /%}.'
        ),
      })
    );
  });

  it("keeps the note free of any location for a pool at one location", async () => {
    mockCheckOut.mockResolvedValue({
      asset: { id: "asset-1" },
      source: {
        locationId: "loc-studio",
        locationName: "Studio",
        explicit: false,
        multiSource: false,
      },
    } as never);

    await action(post(base));

    const content = vi.mocked(createNote).mock.calls[0][0].content;
    expect(content).not.toContain("/locations/");
  });

  it("surfaces the service's refusal when the location has too few left", async () => {
    mockCheckOut.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Camera Room has 2 pcs and 1 is already in custody.",
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = (await action(
      post({ ...base, locationId: "loc-camera" })
    )) as unknown as Response;
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toBe(
      "Camera Room has 2 pcs and 1 is already in custody."
    );
  });

  it("still refuses a SELF_SERVICE user assigning to someone else", async () => {
    asRole(OrganizationRoles.SELF_SERVICE);

    const response = (await action(
      post({ ...base, locationId: "loc-studio" })
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(mockCheckOut).not.toHaveBeenCalled();
  });

  it("still refuses a BASE user outright", async () => {
    vi.mocked(requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You are not allowed to perform this action",
        label: "Permission",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const response = (await action(
      post({ ...base, locationId: "loc-studio" })
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(mockCheckOut).not.toHaveBeenCalled();
  });
});
