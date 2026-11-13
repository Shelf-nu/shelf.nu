import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bookingApprovalView } from "./booking-approval-view";

/**
 * The approval fields of `GET /api/mobile/bookings/:id`, shaped as the webapp
 * route test (`bookings.$bookingId.quick-actions.test.ts`) asserts them.
 */
const PENDING_FOR_APPROVER = {
  isPendingApproval: true,
  canApprove: true,
  reservationNeedsApproval: false,
};

describe("bookingApprovalView", () => {
  it("shows the pill and Approve for an approver of a pending request", () => {
    assert.deepEqual(bookingApprovalView(PENDING_FOR_APPROVER), {
      isPending: true,
      canApprove: true,
      showApprove: true,
      reservationIsRequest: false,
      mayCheckOutNow: true,
    });
  });

  it("shows the pill without Approve to the requester", () => {
    const view = bookingApprovalView({
      ...PENDING_FOR_APPROVER,
      canApprove: false,
    });
    assert.equal(view.isPending, true);
    assert.equal(view.canApprove, false);
    // The requester is not offered check-out the server would refuse.
    assert.equal(view.mayCheckOutNow, false);
  });

  it("hides Approve on an ended request but keeps the approver's check-out", () => {
    const view = bookingApprovalView(
      { ...PENDING_FOR_APPROVER, to: "2026-11-01T17:00:00.000Z" },
      new Date("2026-11-10T12:00:00.000Z")
    );
    assert.equal(view.showApprove, false);
    assert.equal(view.mayCheckOutNow, true);
  });

  it("words a draft's reservation as a request when the server says so", () => {
    assert.equal(
      bookingApprovalView({ reservationNeedsApproval: true })
        .reservationIsRequest,
      true
    );
  });

  it("reads an older server that sends no flags as a plain booking", () => {
    const plain = {
      isPending: false,
      canApprove: false,
      showApprove: false,
      reservationIsRequest: false,
      mayCheckOutNow: true,
    };
    assert.deepEqual(bookingApprovalView({}), plain);
    assert.deepEqual(bookingApprovalView(null), plain);
  });
});
