import { getReminderStatus } from "./reminder-status";

const now = new Date("2026-10-12T12:00:00Z");
const past = "2026-10-10T09:00:00Z";
const future = "2026-10-20T09:00:00Z";
const archivedAt = "2026-10-01T00:00:00Z";

describe("getReminderStatus", () => {
  it("reads Pending, then Reminder sent, for an active asset", () => {
    expect(
      getReminderStatus({
        alertDateTime: future,
        schedulerReference: "job-1",
        assetArchivedAt: null,
        now,
      })
    ).toBe("Pending");
    expect(
      getReminderStatus({
        alertDateTime: past,
        schedulerReference: "job-1",
        assetArchivedAt: null,
        now,
      })
    ).toBe("Reminder sent");
  });

  it("reads Paused while the asset is archived and the alert is ahead", () => {
    expect(
      getReminderStatus({
        alertDateTime: future,
        schedulerReference: "job-1",
        assetArchivedAt: archivedAt,
        now,
      })
    ).toBe("Paused");
  });

  it("reads Not sent for a reminder the worker skipped while archived", () => {
    expect(
      getReminderStatus({
        alertDateTime: past,
        schedulerReference: null,
        assetArchivedAt: archivedAt,
        now,
      })
    ).toBe("Not sent");
  });

  it("keeps Not sent after the asset is reinstated", () => {
    expect(
      getReminderStatus({
        alertDateTime: past,
        schedulerReference: null,
        assetArchivedAt: null,
        now,
      })
    ).toBe("Not sent");
  });

  it("keeps Reminder sent for an alert that fired before the archive", () => {
    expect(
      getReminderStatus({
        alertDateTime: past,
        schedulerReference: "job-1",
        assetArchivedAt: "2026-10-11T00:00:00Z",
        now,
      })
    ).toBe("Reminder sent");
  });

  it("reads Sending while a due reminder's job has not run yet", () => {
    expect(
      getReminderStatus({
        alertDateTime: past,
        schedulerReference: "job-1",
        assetArchivedAt: null,
        deliveryPending: true,
        now,
      })
    ).toBe("Sending");
  });

  it("reads Paused for a due job on an archived asset, which will not send", () => {
    expect(
      getReminderStatus({
        alertDateTime: past,
        schedulerReference: "job-1",
        assetArchivedAt: archivedAt,
        deliveryPending: true,
        now,
      })
    ).toBe("Paused");
  });
});
