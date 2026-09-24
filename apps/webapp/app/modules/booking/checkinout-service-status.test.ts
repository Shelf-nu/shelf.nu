/**
 * The booking statuses each check-out / check-in service refuses itself. This
 * is the service half of spec §4.6.1.
 *
 * Route guards decide who may act on a booking. The services decide which
 * booking statuses they accept. Several §4.6.1 guards read no status at all:
 * mobile partial check-out, both fulfil actions, and quick check-in or
 * check-out for ADMIN. On those paths the refusals pinned here are the only
 * thing between a direct POST and a DRAFT or closed booking. A status check
 * must never move from a service into a guard, or disappear.
 *
 * Each service runs for real against a database fake that answers only the
 * booking and user reads every service starts with. A case is:
 * - `refused` when the service throws its own status refusal;
 * - `accepted` when it gets past that point, proven by touching any other part
 *   of the database, where the fake throws `PastStatusCheck`.
 *
 * Anything else fails the test: an unexpected error is never read as either.
 *
 * `partialCheckinBooking` has no booking-status check. It judges each slice by
 * its check-out marker. Once a batch returns everything still out, it hands
 * completion to `checkinBooking`, whose refusal is pinned in its own row.
 * `checkoutRemainingAssets` is not probed: it reads the remaining payload
 * first and then delegates to `partialCheckoutBooking`, which is pinned here.
 * The `fulfilAndCheckOut` orchestrator is pinned in
 * `fulfil-and-checkout.server.test.ts`.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://../../../test/routes-tests/checkinout-paths.characterization.test.ts}
 */

import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";

// @vitest-environment node

const h = vi.hoisted(() => {
  /** Thrown by every database access other than the booking and user reads. */
  class PastStatusCheck extends Error {}

  const state = { booking: null as { status: string } | null };
  const READS = new Set([
    "findUniqueOrThrow",
    "findFirstOrThrow",
    "findUnique",
    "findFirst",
  ]);
  const USER = {
    id: "user-1",
    email: "caller@example.com",
    firstName: "Casey",
    lastName: "Caller",
    displayName: null,
  };

  const stop = (what: string) => () => {
    throw new PastStatusCheck(what);
  };

  /** One Prisma delegate: booking and user reads answer, the rest stop. */
  function model(name: string) {
    return new Proxy(
      {},
      {
        get(_target, method) {
          if (typeof method !== "string") return undefined;
          if (READS.has(method) && name === "booking") {
            return () => Promise.resolve(state.booking);
          }
          if (READS.has(method) && name === "user") {
            return () => Promise.resolve(USER);
          }
          return stop(`${name}.${method}`);
        },
      }
    );
  }

  const db: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string" || prop === "then") return undefined;
        // The locked in-transaction status read (`lockBookingForStatusCheck`).
        if (prop === "$queryRaw") {
          return () => Promise.resolve([{ status: state.booking?.status }]);
        }
        if (prop === "$transaction") {
          return (work: unknown) =>
            typeof work === "function"
              ? (work as (tx: unknown) => unknown)(db)
              : Promise.all(work as unknown[]);
        }
        if (prop.startsWith("$")) return stop(prop);
        return model(prop);
      },
    }
  );

  return { state, db, PastStatusCheck };
});

// why: the database is the boundary. The fake answers the booking and user
// reads each service starts with. Any other access proves the service got past
// its status check, which is what "accepted" means here.
vi.mock("~/database/db.server", () => ({ db: h.db }));

import {
  checkinAssets,
  checkinBooking,
  checkoutAssets,
  checkoutBooking,
  fulfilModelRequestsAndCheckout,
  partialCheckinBooking,
  partialCheckoutBooking,
} from "./service.server";

const USER_ID = "user-1";
const ORG_ID = "org-1";
const BOOKING_ID = "booking-1";
const ASSET_ID = "asset-1";
const HINTS = { timeZone: "UTC", locale: "en-US" } as never;
const AUTH_SESSION = { userId: USER_ID } as never;

/**
 * A booking holding one INDIVIDUAL asset. With `sliceOut`, that asset's slice
 * has gone out on this booking and not come back, which is what a check-in
 * needs. Without it, the asset is still on the shelf, which a check-out needs.
 */
function bookingRow(status: BookingStatus, sliceOut: boolean) {
  return {
    id: BOOKING_ID,
    organizationId: ORG_ID,
    name: "Status probe",
    status,
    from: new Date("2026-01-01T09:00:00Z"),
    to: new Date("2099-01-02T09:00:00Z"),
    creatorId: USER_ID,
    custodianUserId: USER_ID,
    custodianTeamMemberId: null,
    custodianUser: null,
    custodianTeamMember: null,
    modelRequests: [],
    bookingAssets: [
      {
        id: "booking-asset-1",
        bookingId: BOOKING_ID,
        assetId: ASSET_ID,
        quantity: 1,
        assetKitId: null,
        checkedOutAt: sliceOut ? new Date("2026-01-01T10:00:00Z") : null,
        checkedOutById: sliceOut ? USER_ID : null,
        checkedInAt: null,
        checkedInById: null,
        asset: {
          id: ASSET_ID,
          title: "Probe asset",
          type: AssetType.INDIVIDUAL,
          status: sliceOut ? AssetStatus.CHECKED_OUT : AssetStatus.AVAILABLE,
          organizationId: ORG_ID,
          quantity: null,
          bookingAssets: [],
          assetKits: [],
        },
      },
    ],
  };
}

/** The scanner's form: one asset id. */
function scanForm() {
  const form = new FormData();
  form.append("assetIds[0]", ASSET_ID);
  return form;
}

/** The error and every `cause` behind it. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (
    let e = error;
    e && chain.length < 10;
    e = (e as { cause?: unknown }).cause
  ) {
    chain.push(e);
  }
  return chain;
}

/** The three messages a service uses to refuse a booking by its status. */
const STATUS_REFUSAL =
  /closed records|Only ongoing or overdue bookings|can't be checked out in its current status/;

/**
 * Runs a service and says whether it refused the booking's status.
 *
 * @throws when the service did neither (an unexpected error, or no DB access)
 */
async function outcomeOf(
  run: () => Promise<unknown>
): Promise<"refused" | "accepted"> {
  try {
    await run();
  } catch (error) {
    const chain = causeChain(error);
    if (chain.some((e) => e instanceof h.PastStatusCheck)) return "accepted";
    const messages = chain
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join(" <- ");
    if (STATUS_REFUSAL.test(messages)) return "refused";
    throw new Error(`neither a status refusal nor past the check: ${messages}`);
  }
  throw new Error("the service finished without touching the database");
}

type Probe = { sliceOut: boolean; run: () => Promise<unknown> };

/** Each service, called the way its §4.6.1 paths call it. */
const PROBES = {
  checkoutBooking: {
    sliceOut: false,
    run: () =>
      checkoutBooking({
        id: BOOKING_ID,
        organizationId: ORG_ID,
        hints: HINTS,
        userId: USER_ID,
      }),
  },
  checkinBooking: {
    sliceOut: true,
    run: () =>
      checkinBooking({
        id: BOOKING_ID,
        organizationId: ORG_ID,
        hints: HINTS,
        userId: USER_ID,
      }),
  },
  partialCheckoutBooking: {
    sliceOut: false,
    run: () =>
      partialCheckoutBooking({
        id: BOOKING_ID,
        organizationId: ORG_ID,
        assetIds: [ASSET_ID],
        userId: USER_ID,
        hints: HINTS,
      }),
  },
  checkoutAssets: {
    sliceOut: false,
    run: () =>
      checkoutAssets({
        formData: scanForm(),
        request: new Request("https://app.shelf.nu/"),
        bookingId: BOOKING_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        authSession: AUTH_SESSION,
      }),
  },
  partialCheckinBooking: {
    sliceOut: true,
    run: () =>
      partialCheckinBooking({
        id: BOOKING_ID,
        organizationId: ORG_ID,
        assetIds: [ASSET_ID],
        userId: USER_ID,
        hints: HINTS,
      }),
  },
  checkinAssets: {
    sliceOut: true,
    run: () =>
      checkinAssets({
        formData: scanForm(),
        request: new Request("https://app.shelf.nu/"),
        bookingId: BOOKING_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        authSession: AUTH_SESSION,
      }),
  },
  fulfilModelRequestsAndCheckout: {
    sliceOut: false,
    run: () =>
      fulfilModelRequestsAndCheckout({
        bookingId: BOOKING_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        assetIds: [ASSET_ID],
        hints: HINTS,
      }),
  },
} satisfies Record<string, Probe>;

type ServiceName = keyof typeof PROBES;

const S = BookingStatus;

/**
 * The statuses each service refuses on its own, read from the code:
 * - `checkoutBooking`: `assertBookingIsOpen`, unlocked and again under the row lock;
 * - `checkinBooking`: `assertBookingIsCheckinable`, likewise;
 * - `partialCheckoutBooking`: its inline RESERVED / ONGOING / OVERDUE check
 *   (`checkoutAssets` and `checkoutRemainingAssets` delegate to it);
 * - `partialCheckinBooking` (and `checkinAssets`) and
 *   `fulfilModelRequestsAndCheckout`: none.
 */
const REFUSED_STATUSES: Record<ServiceName, BookingStatus[]> = {
  checkoutBooking: [S.COMPLETE, S.ARCHIVED, S.CANCELLED],
  checkinBooking: [S.DRAFT, S.RESERVED, S.COMPLETE, S.ARCHIVED, S.CANCELLED],
  partialCheckoutBooking: [S.DRAFT, S.COMPLETE, S.ARCHIVED, S.CANCELLED],
  checkoutAssets: [S.DRAFT, S.COMPLETE, S.ARCHIVED, S.CANCELLED],
  partialCheckinBooking: [],
  checkinAssets: [],
  fulfilModelRequestsAndCheckout: [],
};

describe("check-out / check-in services refuse booking statuses themselves (spec §4.6.1)", () => {
  it.each(Object.keys(PROBES) as ServiceName[])("%s", async (name) => {
    const probe: Probe = PROBES[name];
    const refused: BookingStatus[] = [];
    for (const status of Object.values(BookingStatus)) {
      h.state.booking = bookingRow(status, probe.sliceOut);
      if ((await outcomeOf(probe.run)) === "refused") refused.push(status);
    }
    expect([...refused].sort()).toEqual([...REFUSED_STATUSES[name]].sort());
  });
});
