/**
 * POST /api/mobile/asset/archive: the phone's single-asset archive.
 *
 * The route adds no rule of its own; every refusal comes from `archiveAsset`
 * and must reach the app with the same message and status the web gets. The
 * service is mocked to throw each of its real refusals (their rules are
 * covered by the asset service tests). The model-reservation warning also
 * carries `reason: "model_shortfall"`, the field the app keys on.
 *
 * @see {@link file://./../../../app/routes/api+/mobile+/asset.archive.ts}
 * @see {@link file://./mobile.asset.archive.db.test.ts} the rollback, on a real database
 */
import { action } from "~/routes/api+/mobile+/asset.archive";
import { formatModelShortfallMessage } from "~/modules/asset/archive-shortfall";
import { ShelfError } from "~/utils/error";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth, we don't want to hit Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: the archive service writes to the database; its rules are covered by
// the asset service tests, and here it throws each of its real refusals
vi.mock("~/modules/asset/service.server", () => ({
  archiveAsset: vi.fn(),
}));

// why: rate limiting is infra, not the behaviour under test
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
} from "~/modules/api/mobile-auth.server";
import { archiveAsset } from "~/modules/asset/service.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/mobile/asset/archive?orgId=org-1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

/** Posts the body and returns the status and parsed JSON. */
async function post(body: Record<string, unknown>) {
  const result = (await action(
    createActionArgs({ request: createRequest(body) })
  )) as unknown as Response;
  return { status: result.status, json: await result.json() };
}

/** A refusal shaped as `archiveAsset` throws it. */
function refusal(message: string, status: 400 | 404 | 409) {
  return new ShelfError({
    cause: null,
    title: "Can't archive this asset",
    message,
    status,
    label: "Assets",
    shouldBeCaptured: false,
  });
}

const archivedAt = new Date("2026-11-16T10:00:00.000Z");

describe("POST /api/mobile/asset/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireMobileAuth).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    } as Awaited<ReturnType<typeof requireMobileAuth>>);
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
    vi.mocked(requireMobilePermission).mockResolvedValue(
      undefined as unknown as Awaited<
        ReturnType<typeof requireMobilePermission>
      >
    );
  });

  it("archives the asset as the phone user and answers with the web's message", async () => {
    vi.mocked(archiveAsset).mockResolvedValue({
      id: "asset-1",
      archivedAt,
      draftBookings: [],
    });

    const { status, json } = await post({ assetId: "asset-1" });

    expect(status).toBe(200);
    expect(json).toEqual({
      asset: { id: "asset-1", archivedAt: archivedAt.toISOString() },
      draftBookings: [],
      message:
        "The asset is hidden from your lists and can't be booked. You can reinstate it any time.",
    });
    expect(archiveAsset).toHaveBeenCalledWith({
      id: "asset-1",
      organizationId: "org-1",
      // Attributes the ASSET_ARCHIVED event and notes to the phone user.
      actorUserId: "user-1",
      // Not confirmed: the first attempt must be able to warn.
      confirmModelShortfall: false,
    });
  });

  it("names the draft bookings that still hold the asset", async () => {
    vi.mocked(archiveAsset).mockResolvedValue({
      id: "asset-1",
      archivedAt,
      draftBookings: [{ id: "b1", name: "ZZ Shoot" }],
    });

    const { json } = await post({ assetId: "asset-1" });

    expect(json.draftBookings).toEqual([{ id: "b1", name: "ZZ Shoot" }]);
    expect(json.message).toBe(
      "The asset is hidden from your lists and can't be booked. You can reinstate it any time. It is still in the draft booking \"ZZ Shoot\", which can't be reserved until it is removed."
    );
  });

  it("passes the user's 'Archive anyway' to the service", async () => {
    vi.mocked(archiveAsset).mockResolvedValue({
      id: "asset-1",
      archivedAt,
      draftBookings: [],
    });

    await post({ assetId: "asset-1", confirmModelShortfall: true });

    expect(archiveAsset).toHaveBeenCalledWith(
      expect.objectContaining({ confirmModelShortfall: true })
    );
  });

  it("asks for the same grant as the web's Archive (asset: archive)", async () => {
    vi.mocked(archiveAsset).mockResolvedValue({
      id: "asset-1",
      archivedAt,
      draftBookings: [],
    });

    await post({ assetId: "asset-1" });

    expect(requireMobilePermission).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
      entity: "asset",
      action: "archive",
    });
  });

  it("refuses a member without the grant and archives nothing", async () => {
    vi.mocked(requireMobilePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You do not have permission to archive assets.",
        status: 403,
        label: "Permission",
      })
    );

    const { status } = await post({ assetId: "asset-1" });

    expect(status).toBe(403);
    expect(archiveAsset).not.toHaveBeenCalled();
  });

  it("refuses a body without an asset id", async () => {
    const { status } = await post({});

    expect(status).toBe(400);
    expect(archiveAsset).not.toHaveBeenCalled();
  });

  // Each refusal `archiveAsset` throws, with the message and status the web
  // gets. The app shows the message as is; none of them is a shortfall.
  it.each([
    [
      "an asset outside the workspace",
      "This asset does not exist or does not belong to your workspace.",
      404,
    ],
    ["an asset already archived", "This asset is already archived.", 409],
    [
      "a quantity-tracked asset",
      "Only individual assets can be archived. Quantity-tracked assets aren't supported yet.",
      400,
    ],
    [
      "an asset checked out or in custody",
      "Assets that are checked out or in custody can't be archived. Check the asset back in first, then archive it.",
      400,
    ],
    [
      "an asset in a reserved or checked-out booking",
      "This asset is in a reserved or checked-out booking. Remove it from that booking, then archive it.",
      400,
    ],
    [
      "an asset whose status changed during the archive",
      "The asset's status changed before it could be archived. Please refresh and try again.",
      409,
    ],
  ] as const)(
    "passes on the refusal for %s, with its status",
    async (_case, message, status) => {
      vi.mocked(archiveAsset).mockRejectedValue(refusal(message, status));

      const result = await post({ assetId: "asset-1" });

      expect(result.status).toBe(status);
      expect(result.json).toEqual({ error: { message } });
    }
  );

  it("marks the model-reservation warning so the app can offer 'Archive anyway'", async () => {
    const message = formatModelShortfallMessage([
      {
        bookingId: "b1",
        bookingName: "ZZ Shoot",
        modelName: "ZZ Camera",
        short: 1,
      },
    ]);
    vi.mocked(archiveAsset).mockRejectedValue(refusal(message, 409));

    const result = await post({ assetId: "asset-1" });

    expect(result.status).toBe(409);
    expect(result.json).toEqual({
      // The web's exact words, plus the field the app branches on.
      error: { message, reason: "model_shortfall" },
    });
  });

  it("hides an unexpected failure behind the service's generic message", async () => {
    vi.mocked(archiveAsset).mockRejectedValue(
      new ShelfError({
        cause: new Error("connection reset"),
        message: "Something went wrong while archiving the asset.",
        label: "Assets",
      })
    );

    const result = await post({ assetId: "asset-1" });

    expect(result.status).toBe(500);
    expect(result.json).toEqual({
      error: { message: "Something went wrong while archiving the asset." },
    });
  });
});
