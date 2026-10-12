import { getReminderStatus } from "./reminder-status";

const now = new Date("2026-10-12T12:00:00Z");
const past = "2026-10-10T09:00:00Z";
const future = "2026-10-20T09:00:00Z";

describe("getReminderStatus", () => {
  it("reads Pending, then Reminder sent, for an active asset", () => {
    expect(
      getReminderStatus({ alertDateTime: future, assetArchivedAt: null, now })
    ).toBe("Pending");
    expect(
      getReminderStatus({ alertDateTime: past, assetArchivedAt: null, now })
    ).toBe("Reminder sent");
  });

  it("reads Paused while the asset is archived and the alert is ahead", () => {
    expect(
      getReminderStatus({
        alertDateTime: future,
        assetArchivedAt: "2026-10-01T00:00:00Z",
        now,
      })
    ).toBe("Paused");
  });

  it("never claims a send that the archive stopped", () => {
    expect(
      getReminderStatus({
        alertDateTime: past,
        assetArchivedAt: "2026-10-01T00:00:00Z",
        now,
      })
    ).toBe("Not sent");
  });

  it("keeps Reminder sent for an alert that fired before the archive", () => {
    expect(
      getReminderStatus({
        alertDateTime: past,
        assetArchivedAt: "2026-10-11T00:00:00Z",
        now,
      })
    ).toBe("Reminder sent");
  });
});
