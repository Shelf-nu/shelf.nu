/**
 * Which booking the dialog's "already added" answer speaks for.
 *
 * @see {@link file://./booking-overlap-answer.ts}
 */
import { describe, expect, it } from "vitest";

import {
  isAnswerAboutAnotherBooking,
  overlapForPickedBooking,
} from "./booking-overlap-answer";

// The shape `/api/assets/add-to-booking` sends, pinned on the route's side by
// `test/routes-tests/api+/assets.add-to-booking.test.ts`.
const answerAboutA = {
  bookingId: "booking-a",
  alreadyAddedAssets: [{ id: "asset-1", title: "Cable ties" }],
  allAssetsInBooking: false,
};

describe("overlapForPickedBooking", () => {
  it("returns the answer while its booking is the one picked", () => {
    expect(overlapForPickedBooking(answerAboutA, "booking-a")).toEqual(
      answerAboutA
    );
  });

  it("drops the answer once another booking is picked", () => {
    // Otherwise the "add only the rest" flag of booking A would ride along on
    // a submission to booking B and skip assets without saying so.
    expect(overlapForPickedBooking(answerAboutA, "booking-b")).toBeNull();
    expect(overlapForPickedBooking(answerAboutA, undefined)).toBeNull();
  });

  it("returns nothing when there is no overlap to report", () => {
    expect(overlapForPickedBooking(undefined, "booking-a")).toBeNull();
    expect(
      overlapForPickedBooking(
        { ...answerAboutA, alreadyAddedAssets: [] },
        "booking-a"
      )
    ).toBeNull();
    expect(
      overlapForPickedBooking({ bookingId: "booking-a" }, "booking-a")
    ).toBeNull();
  });
});

describe("isAnswerAboutAnotherBooking", () => {
  it("is true only for an answer that names a different booking", () => {
    expect(isAnswerAboutAnotherBooking(answerAboutA, "booking-b")).toBe(true);
    expect(isAnswerAboutAnotherBooking(answerAboutA, undefined)).toBe(true);
    expect(isAnswerAboutAnotherBooking(answerAboutA, "booking-a")).toBe(false);
  });

  it("is false for an error that names no booking", () => {
    expect(isAnswerAboutAnotherBooking(undefined, "booking-a")).toBe(false);
    expect(isAnswerAboutAnotherBooking({}, "booking-a")).toBe(false);
  });
});
