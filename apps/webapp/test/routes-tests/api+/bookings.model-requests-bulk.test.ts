/**
 * The bulk model-reservation write, at the route layer.
 *
 * Three things this route must get right: it forwards the submitted addition
 * untouched, it refuses a booking outside the caller's workspace before the
 * service is reached, and it hands the service's all-or-nothing failure back
 * with the status and message the dialog needs to name the model that was
 * short.
 *
 * @see {@link file://./../../../app/routes/api+/bookings.model-requests-bulk.ts}
 */

// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { upsertBookingModelRequests } from "~/modules/booking-model-request/service.server";
import { action } from "~/routes/api+/bookings.model-requests-bulk";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

// why: the route proves the booking is in the caller's workspace with a direct
// Prisma read; each case drives that read's answer rather than a database.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: the permission check reads the session cookie and the database, and is
// not what these cases vary.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the batch write opens an interactive transaction and takes row locks.
// What matters here is the arguments it receives and the error it raises.
vi.mock("~/modules/booking-model-request/service.server", () => ({
  upsertBookingModelRequests: vi.fn(),
}));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/** One model's line in the submitted form. */
type SubmittedModel = { assetModelId: string; quantity: number };

/**
 * Posts a reservation batch to the route.
 *
 * The body is a `URLSearchParams`, not a `FormData`: the form encodes each
 * model as `models[i].field`, and the search-param form round-trips those
 * names through a `Request` unchanged.
 */
async function submit({
  bookingId = "b1",
  models,
}: {
  bookingId?: string;
  models: SubmittedModel[];
}) {
  const body = new URLSearchParams();
  body.set("bookingId", bookingId);
  models.forEach((model, index) => {
    body.set(`models[${index}].assetModelId`, model.assetModelId);
    body.set(`models[${index}].quantity`, String(model.quantity));
  });

  return action(
    createActionArgs({
      request: new Request(
        "http://localhost/api/bookings/model-requests-bulk",
        {
          method: "POST",
          body,
        }
      ),
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    role: "ADMIN",
    isSelfServiceOrBase: false,
  } as never);

  vi.mocked(db.booking.findFirst).mockResolvedValue({
    id: "b1",
    name: "Autumn shoot",
    creatorId: "user-1",
    custodianUserId: null,
  } as never);

  vi.mocked(upsertBookingModelRequests).mockResolvedValue({
    requests: [{ id: "req-1" }],
  } as never);
});

describe("POST /api/bookings/model-requests-bulk", () => {
  it("forwards the chosen additions unchanged — the service owns the summing", async () => {
    // why: the addition must NOT be pre-summed here. The service reads what
    // the booking already reserves and adds; a route that also added it would
    // double the total, and the write would still succeed, so nothing would
    // report it.
    await submit({ models: [{ assetModelId: "am1", quantity: 3 }] });

    const [args] = vi.mocked(upsertBookingModelRequests).mock.calls[0];
    expect(args.additions).toEqual([{ assetModelId: "am1", quantity: 3 }]);
    expect(args.bookingId).toBe("b1");
    expect(args.organizationId).toBe("org-1");
  });

  it("refuses a booking from another organization", async () => {
    // why: the scoped read finding nothing is the only signal that the id
    // belongs elsewhere — and this case runs as ADMIN, so the guard cannot be
    // passing merely because a restricted role was checked for ownership.
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);

    const response = await submit({
      bookingId: "foreign",
      models: [{ assetModelId: "am1", quantity: 1 }],
    });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(404);
    expect(upsertBookingModelRequests).not.toHaveBeenCalled();
  });

  it("surfaces the service's all-or-nothing failure as a 4xx with its message", async () => {
    vi.mocked(upsertBookingModelRequests).mockRejectedValue(
      new ShelfError({
        cause: null,
        label: "Booking",
        status: 400,
        message: "Not enough units available.",
        shouldBeCaptured: false,
      })
    );

    const response = await submit({
      models: [{ assetModelId: "am1", quantity: 99 }],
    });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);

    const { error } = response.data as { error: { message: string } };
    expect(error.message).toMatch(/not enough units/i);
  });
});
