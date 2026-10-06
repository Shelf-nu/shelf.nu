/**
 * POST /api/assets/release-quantity-custody, from the source-location angle.
 *
 * A person holding units taken from several locations is released per
 * location: the dialog posts the lines as a JSON `sources` field. The route
 * parses them strictly, forwards them (or a single `locationId`) to
 * `releaseQuantity`, and names the sources in the audit note for a pool placed
 * at two or more locations.
 *
 * @see {@link file://./../../../app/routes/api+/assets.release-quantity-custody.ts}
 * @see {@link file://./../../../app/modules/asset/service.custody-source.test.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { releaseQuantity } from "~/modules/asset/service.server";
import { createNote } from "~/modules/note/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { action } from "~/routes/api+/assets.release-quantity-custody";
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

// why: the release write and its per-source rules are the service's
vi.mock("~/modules/asset/service.server", () => ({
  releaseQuantity: vi.fn(),
}));

// why: authorization only needs to resolve here
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the holder lookup reads the database
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

const mockRelease = vi.mocked(releaseQuantity);

function post(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request(
      "https://example.com/api/assets/release-quantity-custody",
      { method: "POST", body: formData }
    ),
    params: {},
  } as unknown as ActionFunctionArgs;
}

const base = { assetId: "asset-1", teamMemberId: "tm-1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    role: OrganizationRoles.ADMIN,
  } as Awaited<ReturnType<typeof requirePermission>>);
  vi.mocked(getTeamMember).mockResolvedValue({
    id: "tm-1",
    name: "Ahmed",
    userId: "user-ahmed",
    user: { id: "user-ahmed", firstName: "Ahmed", lastName: "R" },
  } as never);
  mockRelease.mockResolvedValue({
    asset: { id: "asset-1" },
    consumed: 0,
    returned: 3,
    lines: [],
    multiSource: false,
  } as never);
});

describe("POST /api/assets/release-quantity-custody", () => {
  it("forwards per-location lines parsed from the sources field", async () => {
    const sources = [
      { locationId: "loc-camera", quantity: 2, consumed: 1 },
      { locationId: null, quantity: 1, consumed: 1 },
    ];

    await action(
      post({ ...base, quantity: "3", sources: JSON.stringify(sources) })
    );

    expect(mockRelease).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 3, sources })
    );
  });

  it("refuses an unreadable sources field without releasing anything", async () => {
    const response = (await action(
      post({ ...base, quantity: "3", sources: "[{not json" })
    )) as unknown as Response;

    expect(response.status).toBe(400);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("forwards a single source, and nothing when none was named", async () => {
    await action(post({ ...base, quantity: "1", locationId: "loc-studio" }));
    expect(mockRelease).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: "loc-studio", sources: undefined })
    );

    await action(post({ ...base, quantity: "1" }));
    expect(mockRelease.mock.calls.at(-1)?.[0].locationId).toBeUndefined();
  });

  it("names the sources in the note for a pool with several sources", async () => {
    mockRelease.mockResolvedValue({
      asset: { id: "asset-1" },
      consumed: 0,
      returned: 3,
      multiSource: true,
      lines: [
        {
          locationId: "loc-camera",
          locationName: "Camera Room",
          quantity: 2,
          consumed: 0,
          returned: 2,
        },
        {
          locationId: "loc-studio",
          locationName: "Studio",
          quantity: 1,
          consumed: 0,
          returned: 1,
        },
      ],
    } as never);

    await action(post({ ...base, quantity: "3" }));

    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'custody (2 from {% link to="/locations/loc-camera" text="Camera Room" /%}, 1 from {% link to="/locations/loc-studio" text="Studio" /%}).'
        ),
      })
    );
  });
});
