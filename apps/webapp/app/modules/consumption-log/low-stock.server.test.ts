/**
 * Behavior tests for the debounced, state-transition low-stock notifier
 * (`checkAndNotifyLowStock` in `low-stock.server.ts`).
 *
 * These assert the OBSERVABLE effects of the notifier — which recipients get
 * emailed, whether the in-app notification fires, and how the
 * `Asset.lowStockNotifiedAt` debounce marker is set/cleared as the asset
 * crosses into and out of the low-stock band. The debounce is the whole point
 * of this module, so the tests drive it as a state machine:
 *   enter-low → still-low → recover → re-enter.
 *
 * @see {@link file://./low-stock.server.ts} — the module under test
 */
import { beforeEach, describe, expect, it, vitest } from "vitest";
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
// notifier reads/writes are stubbed.
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirst: vitest.fn(),
      update: vitest.fn().mockResolvedValue({}),
    },
    custody: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    organization: {
      findUnique: vitest.fn().mockResolvedValue({ name: "Acme" }),
    },
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
  vitest.clearAllMocks();
  // clearAllMocks wipes call history but also the resolved-value queues set in
  // the factory for `asset.update` / `custody.aggregate` — restore the stable
  // defaults so tests only override what they exercise.
  assetUpdateMock.mockResolvedValue({});
  custodyAggregateMock.mockResolvedValue({ _sum: { quantity: 0 } });
  getAdminsMock.mockResolvedValue([
    { id: "owner-1", email: "owner@acme.test", firstName: "O", lastName: "W" },
  ]);
  (
    db.organization.findUnique as ReturnType<typeof vitest.fn>
  ).mockResolvedValue({ name: "Acme" });
});

describe("checkAndNotifyLowStock — debounce (enter-low fires once)", () => {
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

describe("checkAndNotifyLowStock — recover (crossing back above threshold)", () => {
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
    // The recovered template — NOT the alert — is the one that renders.
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

describe("checkAndNotifyLowStock — full cycle re-arms the alert", () => {
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

describe("checkAndNotifyLowStock — recipients (owner AND admins)", () => {
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

describe("checkAndNotifyLowStock — minQuantity === 0 (out-of-stock threshold)", () => {
  it("alerts at out-of-stock when the threshold is 0 (does NOT adopt the min<=0 → not-low refinement)", async () => {
    // available 0 <= min 0 → LOW. The package refinement would treat min 0 as
    // "no threshold" and skip — the notifier must NOT.
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

describe("checkAndNotifyLowStock — acting user optional", () => {
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

describe("checkAndNotifyLowStock — early bail-outs", () => {
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
