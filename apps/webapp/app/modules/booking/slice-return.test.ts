import { describe, expect, it } from "vitest";

import { makeIsIndividualSliceOutstanding } from "./slice-return";

const at = (time: string) => new Date(`2026-01-01T${time}:00.000Z`);

const checkin = (time: string, assetIds = ["asset-1"]) => ({
  assetIds,
  checkinTimestamp: at(time),
});
const checkout = (time: string, assetIds = ["asset-1"]) => ({
  assetIds,
  checkoutTimestamp: at(time),
});

describe("makeIsIndividualSliceOutstanding", () => {
  it("does not count a slice that never went out on the booking", () => {
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [],
      checkoutSessions: [],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: null,
        checkedInAt: null,
      })
    ).toBe(false);
  });

  it("counts a slice that went out and has no return", () => {
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [],
      checkoutSessions: [],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: at("10:00"),
        checkedInAt: null,
      })
    ).toBe(true);
  });

  it("accepts a return marker no older than the departure", () => {
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [],
      checkoutSessions: [],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: at("10:00"),
        checkedInAt: at("12:00"),
      })
    ).toBe(false);
  });

  it("accepts a check-in session when the marker has no return", () => {
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [checkin("12:00")],
      checkoutSessions: [],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: at("10:00"),
        checkedInAt: null,
      })
    ).toBe(false);
  });

  it("counts a slice sent out again by scan after its first return", () => {
    // Out at 10:00 and back at 12:00; the scan at 14:00 keeps the 10:00
    // marker and clears the return, leaving the 12:00 session on record.
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [checkin("12:00")],
      checkoutSessions: [checkout("14:00")],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: at("10:00"),
        checkedInAt: null,
      })
    ).toBe(true);
  });

  it("counts a slice sent out again by the Check out button after its first return", () => {
    // The button refreshes the marker to 14:00 and clears the return; the
    // 12:00 session from the first trip stays on record.
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [checkin("12:00")],
      checkoutSessions: [],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: at("14:00"),
        checkedInAt: null,
      })
    ).toBe(true);
  });

  it("accepts a check-in session that answers the latest departure", () => {
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [checkin("12:00"), checkin("16:00")],
      checkoutSessions: [checkout("14:00")],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: at("10:00"),
        checkedInAt: null,
      })
    ).toBe(false);
  });

  it("counts a slice whose return marker predates a later scan departure", () => {
    // Markers stamped from each side's earliest session read as one finished
    // round trip; the 14:00 check-out session is the departure nothing
    // answers.
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [checkin("12:00")],
      checkoutSessions: [checkout("14:00")],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: at("10:00"),
        checkedInAt: at("12:00"),
      })
    ).toBe(true);
  });

  it("reads only the sessions that name the slice's asset", () => {
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [checkin("12:00", ["asset-1"])],
      checkoutSessions: [checkout("14:00", ["asset-2"])],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: at("10:00"),
        checkedInAt: null,
      })
    ).toBe(false);
  });

  it("ignores a session without a time", () => {
    const isOutstanding = makeIsIndividualSliceOutstanding({
      checkinSessions: [{ assetIds: ["asset-1"], checkinTimestamp: null }],
      checkoutSessions: [],
    });

    expect(
      isOutstanding({
        assetId: "asset-1",
        checkedOutAt: at("10:00"),
        checkedInAt: null,
      })
    ).toBe(true);
  });
});
