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
      reservationIsRequest: false,
    });
  });

  it("shows the pill without Approve to the requester", () => {
    const view = bookingApprovalView({
      ...PENDING_FOR_APPROVER,
      canApprove: false,
    });
    assert.equal(view.isPending, true);
    assert.equal(view.canApprove, false);
  });

  it("words a draft's reservation as a request when the server says so", () => {
    assert.equal(
      bookingApprovalView({ reservationNeedsApproval: true })
        .reservationIsRequest,
      true
    );
  });

  it("reads an older server that sends no flags as a plain booking", () => {
    assert.deepEqual(bookingApprovalView({}), {
      isPending: false,
      canApprove: false,
      reservationIsRequest: false,
    });
    assert.deepEqual(bookingApprovalView(null), {
      isPending: false,
      canApprove: false,
      reservationIsRequest: false,
    });
  });
});
