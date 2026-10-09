/**
 * The asset detail action's `archive` and `reinstate` intents (issue #382).
 *
 * Pins two things nothing else would catch:
 *
 * - Both intents are gated on `asset: archive`, the grant the Actions menu
 *   shows the item for. A looser gate would still look right in the browser,
 *   because the menu hides the item, while a crafted POST walks through it.
 * - Neither runs the archived freeze that the other mutating intents do.
 *   Reinstate exists to act on an archived asset, so freezing it would leave
 *   every archived asset stuck.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { archiveAsset, unarchiveAsset } from "~/modules/asset/service.server";
import { ShelfError } from "~/utils/error";
import { assertAssetsAreNotArchived } from "~/utils/org-validation.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: the permission check reads the session cookie and the database; what it
// is called WITH is the contract under test, and its answer is set per case.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the writes behind the intents. Their guards and events are covered by
// the asset service tests; here only which one is reached matters.
vi.mock("~/modules/asset/service.server", () => ({
  archiveAsset: vi.fn(),
  unarchiveAsset: vi.fn(),
  deleteAsset: vi.fn(),
  deleteOtherImages: vi.fn(),
  getAsset: vi.fn(),
  relinkAssetQrCode: vi.fn(),
}));

// why: the archived freeze issues a database count; whether it runs is what
// these cases assert, not what it finds.
vi.mock("~/utils/org-validation.server", () => ({
  assertAssetsAreNotArchived: vi.fn(),
}));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: importing the route reaches `db.server`, which connects at module
// scope; every write here goes through the mocked services above
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the route's modules report through Sentry at import and on error;
// no reporting is under test
vi.mock("@sentry/react-router", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// why: the route transitively imports the scanner success animation, and
// lottie-web touches canvas APIs at import that happy-dom does not provide;
// only the action runs here
vi.mock("lottie-react", () => ({ default: () => null }));

const { action } = await import("~/routes/_layout+/assets.$assetId");

/**
 * Posts `intent` to the detail action for asset `a1`.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
function submit(intent: string) {
  return action(
    createActionArgs({
      request: new Request("http://localhost/assets/a1", {
        method: "POST",
        body: new URLSearchParams({ intent }),
      }),
      params: { assetId: "a1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );
}

describe("asset detail action: archive and reinstate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
      canUseBarcodes: false,
      access: accessFor(["ADMIN"]),
    } as never);
  });

  it.each(["archive", "reinstate"])(
    "gates %s on asset: archive, not asset: update",
    async (intent) => {
      await submit(intent);

      expect(requirePermission).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: PermissionEntity.asset,
          action: PermissionAction.archive,
        })
      );
    }
  );

  it("archives the asset in the caller's workspace", async () => {
    await submit("archive");

    expect(archiveAsset).toHaveBeenCalledWith({
      id: "a1",
      organizationId: "org-1",
      actorUserId: "user-1",
      // Not confirmed: a model-reservation shortfall would be warned about.
      confirmModelShortfall: false,
    });
    expect(unarchiveAsset).not.toHaveBeenCalled();
  });

  it("reinstates without the archived freeze, which would refuse it", async () => {
    await submit("reinstate");

    expect(unarchiveAsset).toHaveBeenCalledWith({
      id: "a1",
      organizationId: "org-1",
      actorUserId: "user-1",
    });
    expect(assertAssetsAreNotArchived).not.toHaveBeenCalled();
  });

  it("still freezes the other mutating intents on an archived asset", async () => {
    // The contrast that makes the case above meaningful: the freeze is wired,
    // just not for reinstate.
    await submit("relink-qr-code");

    expect(assertAssetsAreNotArchived).toHaveBeenCalledWith({
      assetIds: ["a1"],
      organizationId: "org-1",
    });
  });

  it("refuses a caller without the grant and writes nothing", async () => {
    // A BASE or SELF_SERVICE member posting the intent by hand.
    vi.mocked(requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You do not have permission to do this.",
        label: "Permission",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const response = await submit("archive");

    expect(response).toMatchObject({ init: { status: 403 } });
    expect(archiveAsset).not.toHaveBeenCalled();
  });
});
