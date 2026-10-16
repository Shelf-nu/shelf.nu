/**
 * POST /api/assets/adjust-quantity, from the "At location" angle.
 *
 * The Adjust dialog asks where units arrived or were lost only for a pool
 * placed at two or more locations. The route forwards that choice to
 * `adjustQuantity` (absent keeps the adjustment total-only) and names the
 * location in the audit note only when one was named for such a pool.
 *
 * @see {@link file://./../../../app/routes/api+/assets.adjust-quantity.ts}
 * @see {@link file://./../../../app/modules/asset/service.custody-source.test.ts}
 */

import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { adjustQuantity } from "~/modules/consumption-log/service.server";
import { createNote } from "~/modules/note/service.server";
import { action } from "~/routes/api+/assets.adjust-quantity";
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

// why: the stock write and its location rules are the service's
vi.mock("~/modules/consumption-log/service.server", () => ({
  adjustQuantity: vi.fn(),
}));

// why: authorization only needs to resolve here
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

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

const mockAdjust = vi.mocked(adjustQuantity);

function post(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request("https://example.com/api/assets/adjust-quantity", {
      method: "POST",
      body: formData,
    }),
    params: {},
  } as unknown as ActionFunctionArgs;
}

const loss = {
  assetId: "asset-1",
  quantity: "5",
  category: "LOSS",
  direction: "subtract",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
  } as Awaited<ReturnType<typeof requirePermission>>);
  mockAdjust.mockResolvedValue({
    asset: { id: "asset-1" },
    location: { locationId: null, locationName: null, multiSource: false },
  } as never);
});

describe("POST /api/assets/adjust-quantity", () => {
  it("forwards the location, the unplaced word, or nothing", async () => {
    await action(post({ ...loss, locationId: "loc-camera" }));
    expect(mockAdjust).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: "loc-camera" })
    );

    await action(post({ ...loss, locationId: "unplaced" }));
    expect(mockAdjust).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: "unplaced" })
    );

    await action(post(loss));
    expect(mockAdjust.mock.calls.at(-1)?.[0].locationId).toBeUndefined();
  });

  it("names the location in the note for a pool with several sources", async () => {
    mockAdjust.mockResolvedValue({
      asset: { id: "asset-1" },
      location: {
        locationId: "loc-camera",
        locationName: "Camera Room",
        multiSource: true,
      },
    } as never);

    await action(post({ ...loss, locationId: "loc-camera" }));

    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          '(loss) at {% link to="/locations/loc-camera" text="Camera Room" /%}.'
        ),
      })
    );
  });

  it("keeps today's note when no location was asked", async () => {
    await action(post(loss));
    const content = vi.mocked(createNote).mock.calls[0][0].content;
    expect(content).toContain("adjusted quantity by **-5** (loss).");
    expect(content).not.toContain("/locations/");
  });
});
