/**
 * The asset page's action gates each intent on the permission it maps to.
 * Setting a reminder needs `assetReminders:create`, not the right to edit the
 * asset; deleting the asset needs `asset:delete`; relinking a QR code and
 * adding a barcode need `asset:update`.
 *
 * Past the permission gate, a reminder that repeats is a tier capability: the
 * set-reminder intent refuses it with a 403 before anything is written, while
 * one-time reminders stay free on every plan.
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.tsx}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { createAssetReminder } from "~/modules/asset-reminder/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
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

// why: premium features are read once at import; the tier gate only bites
// when they are on, which is the configuration the tier tests need
vi.mock("~/config/shelf.config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/config/shelf.config")>();
  return { config: { ...actual.config, enablePremiumFeatures: true } };
});

// why: the archived-asset guard queries the database; the asset is live here
vi.mock("~/utils/org-validation.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/org-validation.server")>()),
  assertAssetsAreNotArchived: vi.fn().mockResolvedValue(undefined),
}));

// why: the acting user's timezone is read from the database; pin it to UTC
vi.mock("~/utils/date-format.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/date-format.server")>()),
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  }),
}));

// why: the workspace owner's tier is read from the database; each case picks it
vi.mock("~/modules/tier/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/tier/service.server")>()),
  getOrganizationTierLimit: vi.fn(),
}));

// why: creating a reminder writes rows and enqueues a job; the test only
// needs to know whether, and with which cadence, it was requested
vi.mock("~/modules/asset-reminder/service.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/asset-reminder/service.server")
  >()),
  createAssetReminder: vi.fn().mockResolvedValue({ id: "reminder-1" }),
}));

// why: the success toast goes through the server event emitter; no toast is
// under test
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

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

/** The workspace the permission gate resolves for the acting user. */
const ORGANIZATIONS = [
  {
    id: "org-1",
    type: "TEAM" as const,
    name: "Team",
    imageId: null,
    userId: "owner-1",
  },
];

/**
 * Submits a valid set-reminder form with the given Repeat value.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
function submitReminder(repeat: string) {
  return action(
    createActionArgs({
      params: { assetId: "asset-1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      request: new Request("http://localhost/assets/asset-1", {
        method: "POST",
        body: new URLSearchParams({
          intent: "set-reminder",
          name: "Calibrate",
          message: "Send it to the lab",
          alertDateTime: "2099-01-01T09:00",
          "teamMembers[0]": "tm-1",
          repeat,
          redirectTo: "/assets/asset-1/reminders",
        }),
      }),
    })
  );
}

describe("set-reminder tier gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      organizations: ORGANIZATIONS,
    } as never);
  });

  afterEach(() => {
    // Restore the throwing gate the permission cases above rely on.
    vi.mocked(requirePermission).mockImplementation(async () => {
      throw new Error("gate reached");
    });
  });

  it("refuses a repeating reminder with a 403 on a plan without the capability", async () => {
    vi.mocked(getOrganizationTierLimit).mockResolvedValue({
      canUseRecurringReminders: false,
    } as never);

    const result = await submitReminder("monthly");

    expect((result as { init?: ResponseInit | null }).init?.status).toBe(403);
    expect(createAssetReminder).not.toHaveBeenCalled();
  });

  it("creates a one-time reminder on a plan without the capability", async () => {
    vi.mocked(getOrganizationTierLimit).mockResolvedValue({
      canUseRecurringReminders: false,
    } as never);

    const result = await submitReminder("never");

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect(createAssetReminder).toHaveBeenCalledTimes(1);
    expect(createAssetReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        organizationId: "org-1",
        recurrence: null,
      })
    );
    // A one-time reminder never needs the plan lookup.
    expect(getOrganizationTierLimit).not.toHaveBeenCalled();
  });

  it("creates a repeating reminder with its cadence on a plan with the capability", async () => {
    vi.mocked(getOrganizationTierLimit).mockResolvedValue({
      canUseRecurringReminders: true,
    } as never);

    await submitReminder("monthly");

    expect(createAssetReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        recurrence: expect.objectContaining({
          unit: "MONTH",
          interval: 1,
          timezone: "UTC",
        }),
      })
    );
  });
});
