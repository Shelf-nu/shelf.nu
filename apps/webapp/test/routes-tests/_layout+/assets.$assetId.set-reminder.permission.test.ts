/**
 * The asset page's action gates each intent on the permission it maps to.
 * Setting a reminder needs `assetReminders:create`, not the right to edit the
 * asset; deleting the asset needs `asset:delete`; relinking a QR code and
 * adding a barcode need `asset:update`.
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: only the gate is under test; it records its arguments and then throws
// so the action stops before any reminder, barcode or deletion is written
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => {
    throw new Error("gate reached");
  }),
}));

// why: importing the route reaches `db.server`, which connects at module
// scope; the gate throws before any delegate is used
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
 * Submits `intent` to the asset page's action.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
function submit(intent: string) {
  return action(
    createActionArgs({
      params: { assetId: "asset-1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      request: new Request("http://localhost/assets/asset-1", {
        method: "POST",
        body: new URLSearchParams({ intent }),
      }),
    })
  );
}

describe("asset page action gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      intent: "set-reminder",
      entity: PermissionEntity.assetReminders,
      action: PermissionAction.create,
    },
    {
      intent: "delete",
      entity: PermissionEntity.asset,
      action: PermissionAction.delete,
    },
    {
      intent: "relink-qr-code",
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    },
    {
      intent: "add-barcode",
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    },
  ])("$intent requires $entity:$action", async ({ intent, entity, action }) => {
    await submit(intent);

    expect(requirePermission).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requirePermission).mock.calls[0][0]).toMatchObject({
      entity,
      action,
    });
  });
});
