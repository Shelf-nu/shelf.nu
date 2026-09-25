/**
 * Behavior tests for the debounced, state-transition low-stock notifier
 * (`checkAndNotifyLowStock` in `low-stock.server.ts`).
 *
 * These assert the OBSERVABLE effects of the notifier: which recipients get
 * emailed, whether the in-app notification fires, how the
 * `Asset.lowStockNotifiedAt` debounce marker is set/cleared as the asset
 * crosses into and out of the low-stock band, and which facts each recipient's
 * copy of the mail is rendered from. The debounce is the whole point of this
 * module, so the tests drive it as a state machine:
 *   enter-low → still-low → recover → re-enter.
 *
 * @see {@link file://./low-stock.server.ts} - the module under test
 */
import { afterEach, beforeEach, describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";

// why: assert email dispatch without sending real mail.
const sendEmailMock = vitest.fn();
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

// why: assert the in-app notification without touching the real SSE emitter.
const sendNotificationMock = vitest.fn();
vitest.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
}));

// why: the recipient resolver is exhaustively tested in the organization
// service; here we control exactly who it returns so recipient assertions
// don't depend on org fixtures.
const getAdminsMock = vitest.fn();
vitest.mock("~/modules/organization/service.server", () => ({
  getOrganizationAdminsForNotification: (...args: unknown[]) =>
    getAdminsMock(...args),
}));

// why: the email templates call react-email's async `render()`, which is heavy
// and irrelevant to the notifier's transition logic. Stub the builders so the
// notifier's dispatch decisions are what we test, not HTML output.
const lowStockAlertHtmlMock = vitest
  .fn()
  .mockResolvedValue("<html>alert</html>");
const lowStockAlertTextMock = vitest.fn().mockReturnValue("alert text");
vitest.mock("~/emails/low-stock-alert", () => ({
  lowStockAlertHtml: (...args: unknown[]) => lowStockAlertHtmlMock(...args),
  lowStockAlertText: (...args: unknown[]) => lowStockAlertTextMock(...args),
}));

const lowStockRecoveredHtmlMock = vitest
  .fn()
  .mockResolvedValue("<html>recovered</html>");
const lowStockRecoveredTextMock = vitest.fn().mockReturnValue("recovered text");
vitest.mock("~/emails/low-stock-recovered", () => ({
  lowStockRecoveredHtml: (...args: unknown[]) =>
    lowStockRecoveredHtmlMock(...args),
  lowStockRecoveredText: (...args: unknown[]) =>
    lowStockRecoveredTextMock(...args),
}));

// why: isolate the notifier from a real database. Only the delegates the
// notifier reads/writes are stubbed; defaults are restored in `beforeEach`.
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirst: vitest.fn(),
      update: vitest.fn(),
      count: vitest.fn(),
      // The column reference the low-stock predicate compares quantity to.
      fields: { minQuantity: "Asset.minQuantity" },
    },
    custody: { aggregate: vitest.fn() },
    organization: { findUnique: vitest.fn() },
    consumptionLog: { findMany: vitest.fn() },
    assetLocation: { findMany: vitest.fn() },
    user: { findUnique: vitest.fn() },
  },
}));

import { checkAndNotifyLowStock } from "./low-stock.server";

const ASSET_ID = "asset-1";
const ORG_ID = "org-1";
const USER_ID = "user-1";

const findFirstMock = db.asset.findFirst as ReturnType<typeof vitest.fn>;
const assetUpdateMock = db.asset.update as ReturnType<typeof vitest.fn>;
const custodyAggregateMock = db.custody.aggregate as ReturnType<
  typeof vitest.fn
>;
const assetCountMock = db.asset.count as ReturnType<typeof vitest.fn>;
const orgFindUniqueMock = db.organization.findUnique as ReturnType<
  typeof vitest.fn
>;
const logFindManyMock = db.consumptionLog.findMany as ReturnType<
  typeof vitest.fn
>;
const placementsMock = db.assetLocation.findMany as ReturnType<
  typeof vitest.fn
>;
const userFindUniqueMock = db.user.findUnique as ReturnType<typeof vitest.fn>;

/**
 * A quantity-tracked asset row as `db.asset.findFirst` returns it inside the
 * notifier. Callers override the fields relevant to the transition under test.
 */
function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    title: "Widget",
    quantity: 5,
    minQuantity: 5,
    unitOfMeasure: "boards",
    type: "QUANTITY_TRACKED",
    lowStockNotifiedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vitest.resetAllMocks();
  // resetAllMocks drops every implementation, so each test starts from these
  // stable defaults and overrides only what it exercises.
  assetUpdateMock.mockResolvedValue({});
  assetCountMock.mockResolvedValue(0);
  custodyAggregateMock.mockResolvedValue({ _sum: { quantity: 0 } });
  orgFindUniqueMock.mockResolvedValue({
    name: "Acme",
    customEmailFooter: null,
  });
  logFindManyMock.mockResolvedValue([]);
  placementsMock.mockResolvedValue([]);
  userFindUniqueMock.mockResolvedValue(null);
  lowStockAlertHtmlMock.mockResolvedValue("<html>alert</html>");
  lowStockAlertTextMock.mockReturnValue("alert text");
  lowStockRecoveredHtmlMock.mockResolvedValue("<html>recovered</html>");
  lowStockRecoveredTextMock.mockReturnValue("recovered text");
  getAdminsMock.mockResolvedValue([
    { id: "owner-1", email: "owner@acme.test", firstName: "O", lastName: "W" },
  ]);
});

describe("checkAndNotifyLowStock: debounce (enter-low fires once)", () => {
  it("fires the alert AND stamps lowStockNotifiedAt when crossing into low stock", async () => {
    // available = 5 − 0 = 5 <= min 5 → low; marker null → ENTER.
    findFirstMock.mockResolvedValue(assetRow({ quantity: 5, minQuantity: 5 }));

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(lowStockAlertHtmlMock).toHaveBeenCalledTimes(1);
    // The debounce marker is stamped with a Date so a further decrement while
    // still low won't re-fire.
    expect(assetUpdateMock).toHaveBeenCalledWith({
      where: { id: ASSET_ID, organizationId: ORG_ID },
      data: { lowStockNotifiedAt: expect.any(Date) },
    });
  });

  it("does NOT throw when the in-app notification fails, best-effort (email + marker still proceed)", async () => {
    // Enter-low scenario, but the SSE emitter is down: sendNotification
    // re-throws a ShelfError. The notifier must swallow it: it runs AFTER a
    // committed stock mutation and some callers invoke it without their own
    // try/catch, so a notification failure must never bubble up.
    findFirstMock.mockResolvedValue(assetRow({ quantity: 5, minQuantity: 5 }));
    sendNotificationMock.mockImplementation(() => {
      throw new Error("emitter down");
    });

    await expect(
      checkAndNotifyLowStock({
        assetId: ASSET_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).resolves.toBeUndefined();

    // The failed in-app send must not abort the rest of the flow.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(assetUpdateMock).toHaveBeenCalledWith({
      where: { id: ASSET_ID, organizationId: ORG_ID },
      data: { lowStockNotifiedAt: expect.any(Date) },
    });
  });

  it("does NOT re-fire while already-notified and still low (marker already set)", async () => {
    // available 3 <= min 5 → low, but marker already set → NO-OP.
    findFirstMock.mockResolvedValue(
      assetRow({ quantity: 3, minQuantity: 5, lowStockNotifiedAt: new Date() })
    );

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(assetUpdateMock).not.toHaveBeenCalled();
  });
});

describe("checkAndNotifyLowStock: recover (crossing back above threshold)", () => {
  it("clears the marker and sends the recovered notice when crossing back up", async () => {
    // available 20 > min 5 → not low, marker set → RECOVER.
    findFirstMock.mockResolvedValue(
      assetRow({ quantity: 20, minQuantity: 5, lowStockNotifiedAt: new Date() })
    );

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(assetUpdateMock).toHaveBeenCalledWith({
      where: { id: ASSET_ID, organizationId: ORG_ID },
      data: { lowStockNotifiedAt: null },
    });
    // The recovered template, NOT the alert, is the one that renders.
    expect(lowStockRecoveredHtmlMock).toHaveBeenCalledTimes(1);
    expect(lowStockAlertHtmlMock).not.toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when fine-and-was-fine (not low, no marker)", async () => {
    // available 20 > min 5 → not low, marker null → NO-OP.
    findFirstMock.mockResolvedValue(
      assetRow({ quantity: 20, minQuantity: 5, lowStockNotifiedAt: null })
    );

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(assetUpdateMock).not.toHaveBeenCalled();
  });
});

describe("checkAndNotifyLowStock: full cycle re-arms the alert", () => {
  it("fires again after a recover (enter → still-low no-op → recover → re-enter)", async () => {
    // 1) ENTER low: available 5 <= 5, marker null → fires + stamps.
    findFirstMock.mockResolvedValueOnce(
      assetRow({ quantity: 5, minQuantity: 5, lowStockNotifiedAt: null })
    );
    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(lowStockAlertHtmlMock).toHaveBeenCalledTimes(1);

    // 2) STILL low, marker set → no-op.
    findFirstMock.mockResolvedValueOnce(
      assetRow({ quantity: 4, minQuantity: 5, lowStockNotifiedAt: new Date() })
    );
    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // unchanged

    // 3) RECOVER, marker set → clears + recovered notice.
    findFirstMock.mockResolvedValueOnce(
      assetRow({ quantity: 30, minQuantity: 5, lowStockNotifiedAt: new Date() })
    );
    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });
    expect(lowStockRecoveredHtmlMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);

    // 4) RE-ENTER low, marker back to null → fires the alert AGAIN.
    findFirstMock.mockResolvedValueOnce(
      assetRow({ quantity: 5, minQuantity: 5, lowStockNotifiedAt: null })
    );
    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });
    expect(lowStockAlertHtmlMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock).toHaveBeenCalledTimes(3);
  });
});

describe("checkAndNotifyLowStock: recipients (owner AND admins)", () => {
  it("emails every owner/admin the resolver returns, not just the owner", async () => {
    getAdminsMock.mockResolvedValue([
      {
        id: "owner-1",
        email: "owner@acme.test",
        firstName: "O",
        lastName: "W",
      },
      {
        id: "admin-2",
        email: "admin2@acme.test",
        firstName: "A",
        lastName: "D",
      },
      {
        id: "admin-3",
        email: "admin3@acme.test",
        firstName: "B",
        lastName: "E",
      },
    ]);
    findFirstMock.mockResolvedValue(assetRow({ quantity: 5, minQuantity: 5 }));

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(3);
    const recipients = sendEmailMock.mock.calls.map(
      (c) => (c[0] as { to: string }).to
    );
    expect(recipients).toEqual([
      "owner@acme.test",
      "admin2@acme.test",
      "admin3@acme.test",
    ]);
  });

  it("a single bad recipient send does not abort the loop for the rest", async () => {
    getAdminsMock.mockResolvedValue([
      {
        id: "owner-1",
        email: "owner@acme.test",
        firstName: "O",
        lastName: "W",
      },
      {
        id: "admin-2",
        email: "admin2@acme.test",
        firstName: "A",
        lastName: "D",
      },
    ]);
    // First send throws; the loop must still attempt the second.
    sendEmailMock
      .mockImplementationOnce(() => {
        throw new Error("bad address");
      })
      .mockImplementation(() => undefined);
    findFirstMock.mockResolvedValue(assetRow({ quantity: 5, minQuantity: 5 }));

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    // The marker is still stamped despite the send error (best-effort).
    expect(assetUpdateMock).toHaveBeenCalledWith({
      where: { id: ASSET_ID, organizationId: ORG_ID },
      data: { lowStockNotifiedAt: expect.any(Date) },
    });
  });
});

describe("checkAndNotifyLowStock: minQuantity === 0 (out-of-stock threshold)", () => {
  it("alerts at out-of-stock when the threshold is 0 (does NOT adopt the min<=0 → not-low refinement)", async () => {
    // available 0 <= min 0 → LOW. The package refinement would treat min 0 as
    // "no threshold" and skip; the notifier must NOT.
    findFirstMock.mockResolvedValue(
      assetRow({ quantity: 3, minQuantity: 0, lowStockNotifiedAt: null })
    );
    custodyAggregateMock.mockResolvedValue({ _sum: { quantity: 3 } }); // available 0

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(lowStockAlertHtmlMock).toHaveBeenCalledTimes(1);
    expect(assetUpdateMock).toHaveBeenCalledWith({
      where: { id: ASSET_ID, organizationId: ORG_ID },
      data: { lowStockNotifiedAt: expect.any(Date) },
    });
  });

  it("stays quiet for a 0-threshold asset that still has stock available", async () => {
    // available 2 > min 0 → not low, marker null → NO-OP.
    findFirstMock.mockResolvedValue(
      assetRow({ quantity: 2, minQuantity: 0, lowStockNotifiedAt: null })
    );

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(assetUpdateMock).not.toHaveBeenCalled();
  });
});

describe("checkAndNotifyLowStock: acting user optional", () => {
  it("emails owner+admins but skips the in-app sender when there is no acting user", async () => {
    findFirstMock.mockResolvedValue(assetRow({ quantity: 5, minQuantity: 5 }));

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: undefined,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    // No acting user → no in-app notification target.
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(assetUpdateMock).toHaveBeenCalled();
  });
});

describe("checkAndNotifyLowStock: early bail-outs", () => {
  it("does nothing when the asset is not found", async () => {
    findFirstMock.mockResolvedValue(null);

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(assetUpdateMock).not.toHaveBeenCalled();
    expect(custodyAggregateMock).not.toHaveBeenCalled();
  });

  it("does nothing for a non-QUANTITY_TRACKED asset", async () => {
    findFirstMock.mockResolvedValue(
      assetRow({ type: "INDIVIDUAL", minQuantity: 5, quantity: 1 })
    );

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(assetUpdateMock).not.toHaveBeenCalled();
  });

  it("clears a stale marker (no notice) when the threshold has been removed", async () => {
    // minQuantity null but a marker lingers from a prior low episode → the
    // notifier silently clears it (a threshold-less asset can't be low).
    findFirstMock.mockResolvedValue(
      assetRow({ minQuantity: null, lowStockNotifiedAt: new Date() })
    );

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(assetUpdateMock).toHaveBeenCalledWith({
      where: { id: ASSET_ID, organizationId: ORG_ID },
      data: { lowStockNotifiedAt: null },
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
    // No availability read is needed for the stale-marker cleanup.
    expect(custodyAggregateMock).not.toHaveBeenCalled();
  });

  it("does nothing when there is no threshold and no stale marker", async () => {
    findFirstMock.mockResolvedValue(
      assetRow({ minQuantity: null, lowStockNotifiedAt: null })
    );

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(assetUpdateMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("checkAndNotifyLowStock: never rejects", () => {
  // Every caller runs this AFTER its mutation has committed. An escaping
  // rejection answers 500 for a request whose write succeeded, the client
  // retries, and the non-idempotent mutation behind it allocates twice.

  it("swallows a failure of its very first read", async () => {
    // why: the opening `asset.findFirst` is the first thing the check does and
    // carries no guard of its own, so a transient database failure there is
    // the shortest path to an escaping rejection. The contract under test is
    // that the returned promise resolves anyway.
    findFirstMock.mockRejectedValue(new Error("connection reset"));

    await expect(
      checkAndNotifyLowStock({
        assetId: ASSET_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).resolves.toBeUndefined();
  });

  it("swallows a failure of the availability read", async () => {
    // why: a healthy asset row gets the check past its first statement, so the
    // failure lands on the custody aggregate instead, also unguarded, and far
    // enough in to show the contract covers the whole check rather than one
    // chosen statement.
    findFirstMock.mockResolvedValue(assetRow({ quantity: 1, minQuantity: 5 }));
    custodyAggregateMock.mockRejectedValue(new Error("aggregate failed"));

    await expect(
      checkAndNotifyLowStock({
        assetId: ASSET_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).resolves.toBeUndefined();
  });

  it("still reports low stock when nothing fails", async () => {
    // why: an asset below its threshold with nothing failing, the case that
    // proves the guard did not turn the notifier into a no-op.
    findFirstMock.mockResolvedValue(assetRow({ quantity: 1, minQuantity: 5 }));

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).toHaveBeenCalled();
  });
});

describe("checkAndNotifyLowStock: the facts each copy is rendered from", () => {
  /** The moment the notifier runs; the log row below is one minute older. */
  const NOW = new Date("2026-09-24T20:54:00.000Z");
  const LOGGED_AT = new Date("2026-09-24T20:53:00.000Z");

  /** A fresh CONSUME row by Dana Reyes, as the notifier selects it. */
  const consumeRow = {
    category: "CONSUME",
    quantity: 3,
    note: null,
    createdAt: LOGGED_AT,
    userId: "user-dana",
    performedBy: { firstName: "Dana", lastName: "Reyes", displayName: null },
    custodianId: null,
    custodian: null,
    booking: null,
  };

  /** Props the alert template was rendered with, one entry per recipient. */
  function alertRenders() {
    return lowStockAlertHtmlMock.mock.calls.map(
      (call) => call[0] as Record<string, unknown>
    );
  }

  beforeEach(() => {
    // why: the "What happened" row is only used while the log row is fresh,
    // measured against the clock; freeze it so freshness is deterministic.
    vitest.useFakeTimers({ toFake: ["Date"] });
    vitest.setSystemTime(NOW);
  });

  afterEach(() => {
    vitest.useRealTimers();
  });

  it("renders once per recipient, in that recipient's name, address and date format", async () => {
    getAdminsMock.mockResolvedValue([
      {
        id: "owner-1",
        email: "ana@clearwater.test",
        firstName: "Ana",
        lastName: "Cole",
        displayName: null,
        dateFormat: "DD_MMM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "UTC",
      },
      {
        id: "admin-2",
        email: "ben@clearwater.test",
        firstName: "Benjamin",
        lastName: "Hart",
        displayName: "Benji",
        dateFormat: "MM_DD_YYYY",
        timeFormat: "H12",
        weekStart: "SUNDAY",
        timeZone: "America/New_York",
      },
    ]);
    findFirstMock.mockResolvedValue(assetRow({ quantity: 2, minQuantity: 5 }));
    logFindManyMock.mockResolvedValue([consumeRow]);

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    const renders = alertRenders();
    expect(renders).toHaveLength(2);
    expect(lowStockAlertTextMock).toHaveBeenCalledTimes(2);
    expect(renders.map((r) => r.recipient)).toEqual([
      { greetingName: "Ana", email: "ana@clearwater.test" },
      { greetingName: "Benji", email: "ben@clearwater.test" },
    ]);
    expect(renders.map((r) => (r.movement as { text: string }).text)).toEqual([
      "3 boards used up by Dana Reyes on 24 Sep 2026 at 20:53",
      "3 boards used up by Dana Reyes on 09/24/2026 at 4:53 PM",
    ]);

    // One subject for everyone, with the numbers in it.
    const subjects = sendEmailMock.mock.calls.map(
      (c) => (c[0] as { subject: string }).subject
    );
    expect(subjects).toEqual([
      "Low stock: Widget (2 boards left, minimum 5)",
      "Low stock: Widget (2 boards left, minimum 5)",
    ]);
  });

  it("loads placements, custody, other low items and the custom footer", async () => {
    // 5 in stock, 3 in custody: 2 available against a minimum of 5.
    findFirstMock.mockResolvedValue(assetRow({ quantity: 5, minQuantity: 5 }));
    custodyAggregateMock.mockResolvedValue({ _sum: { quantity: 3 } });
    orgFindUniqueMock.mockResolvedValue({
      name: "Clearwater Supply",
      customEmailFooter: "Clearwater Supply, 12 Harbor Road",
    });
    placementsMock.mockResolvedValue([
      { quantity: 1, location: { name: "Ogden warehouse" } },
      { quantity: 1, location: { name: "Ogden warehouse" } },
      { quantity: 1, location: { name: "Van 3" } },
    ]);
    assetCountMock.mockResolvedValue(1);
    logFindManyMock.mockResolvedValue([consumeRow]);

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(alertRenders()[0]).toMatchObject({
      assetTitle: "Widget",
      assetId: ASSET_ID,
      available: 2,
      minQuantity: 5,
      unitOfMeasure: "boards",
      organizationName: "Clearwater Supply",
      customEmailFooter: "Clearwater Supply, 12 Harbor Road",
      placements: "Ogden warehouse: 2, Van 3: 1",
      inCustody: 3,
      otherLowCount: 1,
    });

    // The count uses the same predicate as the list the mail links to, and
    // leaves this asset out.
    expect(assetCountMock).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        id: { not: ASSET_ID },
        type: "QUANTITY_TRACKED",
        minQuantity: { not: null },
        quantity: { lte: "Asset.minQuantity" },
      },
    });
    // Placements are org-scoped.
    expect(placementsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: ASSET_ID, organizationId: ORG_ID },
      })
    );
    // A fresh log row explains the change, so the acting user is not loaded.
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("names the acting user when no log row explains the change", async () => {
    findFirstMock.mockResolvedValue(assetRow({ quantity: 2, minQuantity: 5 }));
    logFindManyMock.mockResolvedValue([]);
    userFindUniqueMock.mockResolvedValue({
      firstName: "Sam",
      lastName: "Ortiz",
      displayName: null,
    });

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(userFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } })
    );
    expect(alertRenders()[0].movement).toEqual({
      text: "Stock or minimum was changed by Sam Ortiz",
    });
  });

  it("names the acting user when the log row is older than the change", async () => {
    findFirstMock.mockResolvedValue(assetRow({ quantity: 2, minQuantity: 5 }));
    logFindManyMock.mockResolvedValue([
      { ...consumeRow, createdAt: new Date("2026-09-24T19:00:00.000Z") },
    ]);
    userFindUniqueMock.mockResolvedValue({
      firstName: "Sam",
      lastName: "Ortiz",
      displayName: null,
    });

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(alertRenders()[0].movement).toEqual({
      text: "Stock or minimum was changed by Sam Ortiz",
    });
  });

  it("leaves out What happened with no log row and no acting user", async () => {
    findFirstMock.mockResolvedValue(assetRow({ quantity: 2, minQuantity: 5 }));

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: null,
      organizationId: ORG_ID,
    });

    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(alertRenders()[0].movement).toBeNull();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("still sends when the optional reads fail, and claims nothing it could not read", async () => {
    findFirstMock.mockResolvedValue(assetRow({ quantity: 2, minQuantity: 5 }));
    logFindManyMock.mockRejectedValue(new Error("log read failed"));
    placementsMock.mockRejectedValue(new Error("placements read failed"));
    assetCountMock.mockRejectedValue(new Error("count failed"));
    userFindUniqueMock.mockResolvedValue({
      firstName: "Sam",
      lastName: "Ortiz",
      displayName: null,
    });

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(alertRenders()[0]).toMatchObject({
      movement: { text: "Stock or minimum was changed by Sam Ortiz" },
      // Unknown, not "Not placed at a location": the row is left out.
      placements: null,
      otherLowCount: 0,
    });
  });

  it("passes an empty unit label through, so the subject prints bare numbers", async () => {
    findFirstMock.mockResolvedValue(
      assetRow({ quantity: 2, minQuantity: 5, unitOfMeasure: "" })
    );

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: null,
      organizationId: ORG_ID,
    });

    expect(alertRenders()[0].unitOfMeasure).toBe("");
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Low stock: Widget (2 left, minimum 5)",
      })
    );
  });

  it("describes every row of a booking check-in, not one tied row", async () => {
    findFirstMock.mockResolvedValue(assetRow({ quantity: 2, minQuantity: 5 }));
    const springFair = { id: "bk-1", name: "Spring Fair" };
    // One check-in transaction: rows land milliseconds apart, newest first.
    logFindManyMock.mockResolvedValue([
      { ...consumeRow, category: "RETURN", quantity: 4, booking: springFair },
      { ...consumeRow, category: "LOSS", quantity: 1, booking: springFair },
      {
        ...consumeRow,
        category: "CONSUME",
        quantity: 3,
        booking: springFair,
        createdAt: new Date(LOGGED_AT.getTime() - 5),
      },
    ]);

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(logFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: ASSET_ID },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    );
    expect(alertRenders()[0].movement).toEqual({
      text: "3 boards used up, 1 boards reported lost and 4 boards returned by Dana Reyes during booking Spring Fair on 09/24/2026 at 8:53 PM",
      href: "/bookings/bk-1",
    });
  });

  it("gives the back-in-stock notice the same facts", async () => {
    findFirstMock.mockResolvedValue(
      assetRow({ quantity: 14, minQuantity: 5, lowStockNotifiedAt: new Date() })
    );
    logFindManyMock.mockResolvedValue([
      { ...consumeRow, category: "RESTOCK", quantity: 12 },
    ]);
    placementsMock.mockResolvedValue([
      { quantity: 14, location: { name: "Ogden warehouse" } },
    ]);
    assetCountMock.mockResolvedValue(2);

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(lowStockRecoveredHtmlMock).toHaveBeenCalledTimes(1);
    expect(lowStockRecoveredHtmlMock.mock.calls[0][0]).toMatchObject({
      available: 14,
      placements: "Ogden warehouse: 14",
      otherLowCount: 2,
      movement: {
        text: "12 boards restocked by Dana Reyes on 09/24/2026 at 8:53 PM",
      },
    });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Back in stock: Widget (14 boards, minimum 5)",
      })
    );
  });

  it("one recipient's failed render does not stop the others", async () => {
    getAdminsMock.mockResolvedValue([
      { id: "owner-1", email: "owner@acme.test", firstName: "O" },
      { id: "admin-2", email: "admin2@acme.test", firstName: "A" },
    ]);
    findFirstMock.mockResolvedValue(assetRow({ quantity: 2, minQuantity: 5 }));
    lowStockAlertHtmlMock.mockRejectedValueOnce(new Error("render failed"));

    await checkAndNotifyLowStock({
      assetId: ASSET_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin2@acme.test" })
    );
  });
});
