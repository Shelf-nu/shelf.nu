/**
 * Check-out / check-in characterization: every check-out/check-in path
 * (`@helpers/checkinout-cases`), as its guards decide today.
 *
 * Each path runs, loader and action separately, through the REAL route, the
 * REAL `requirePermission` and mobile auth helpers, and the REAL ownership,
 * partial-scan and explicit-scan guards. It is evaluated for every role set,
 * booking relationship, booking status and workspace variant in
 * `@helpers/checkinout-cases`. A case is recorded as:
 *
 * - `allowed` only when the route reached its sentinel, the stand-in for the
 *   first dependency it calls once every guard has passed, handed this booking.
 *   The fulfil actions also record the explicit-check-out flag they hand on.
 * - `denied` when the route answered with a guard refusal: a 403, or the one
 *   non-403 refusal `NON_403_REFUSALS` names.
 *
 * Any other answer fails the test and names the case. An unexpected error is
 * never read as either outcome.
 *
 * The outcomes are committed as `__snapshots__/checkinout-paths.json`, and the
 * role-policy refactor keeps that file byte-identical except for the B9 cells
 * it lists. The other half of the contract is which statuses each SERVICE
 * refuses once a guard lets the call through. That half is pinned in
 * `app/modules/booking/checkinout-service-status.test.ts` and
 * `app/modules/booking/fulfil-and-checkout.server.test.ts`. A guard that lets
 * a COMPLETE booking through here is correct as long as the service behind it
 * refuses it there.
 *
 * Run the whole file: the snapshot is assembled across its tests.
 *
 * @see {@link file://../helpers/checkinout-cases.ts}
 */

import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import type * as BookingServiceServer from "~/modules/booking/service.server";
import type * as BookingModelRequests from "~/utils/booking-model-requests";

// @vitest-environment node

const h = vi.hoisted(() => {
  /** One call to a sentinel: which dependency, with what arguments. */
  type Reached = { name: string; args: unknown[] };

  /** The rows the fakes hand the real code; replaced before every case. */
  const state = {
    user: null as unknown,
    selectedOrganization: null as unknown,
    membership: null as unknown,
    organization: null as unknown,
    booking: null as unknown,
    settings: null as unknown,
    workingHours: null as unknown,
    reached: [] as Reached[],
  };

  /**
   * A stand-in for the first dependency a path calls once every guard has
   * passed. Records the call, then stops the route by throwing synchronously:
   * nothing after the guard is under test here.
   */
  function sentinel(name: string) {
    return (...args: unknown[]): never => {
      state.reached.push({ name, args });
      throw new Error(`characterization sentinel: ${name}`);
    };
  }

  return { state, sentinel };
});

// why: the database is the boundary. The fake answers exactly the reads these
// paths make up to their sentinel, from the case's rows. A read it does not
// expect is a TypeError, which fails the case instead of being recorded.
vi.mock("~/database/db.server", () => {
  const read = (pick: () => unknown) => () => Promise.resolve(pick());
  return {
    db: {
      user: { findUniqueOrThrow: read(() => h.state.user) },
      userOrganization: {
        findUnique: read(() => h.state.membership),
        findFirst: read(() => h.state.membership),
      },
      organization: { findUnique: read(() => h.state.organization) },
      booking: {
        findFirst: read(() => h.state.booking),
        findFirstOrThrow: read(() => h.state.booking),
        findUniqueOrThrow: read(() => h.state.booking),
      },
      bookingSettings: { findUnique: read(() => h.state.settings) },
      workingHours: { findUnique: read(() => h.state.workingHours) },
      // The overview check-in intent lists the assets still out after its
      // guards and before `checkinBooking`; it cannot refuse.
      asset: { findMany: read(() => []) },
    },
  };
});

// why: the selected organization comes from a cookie and the database. The
// case chooses the membership's roles and the workspace toggles; everything
// else in `requirePermission` runs for real.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: () => Promise.resolve(h.state.selectedOrganization),
  setSelectedOrganizationIdCookie: () =>
    Promise.resolve("selected-organization=org-1"),
}));

// why: mobile identity is a Supabase JWT check. Membership, the permission
// gate and the caller's role context stay real, over the fake database.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: () =>
      Promise.resolve({ user: h.state.user, authUser: {} }),
  };
});

// why: each of these is the first dependency a path calls once its guards
// pass, so each is that path's sentinel. What the service then does with the
// booking's status is pinned by checkinout-service-status.test.ts.
// `getBooking` and the rest stay real.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    checkoutBooking: h.sentinel("checkoutBooking"),
    checkinBooking: h.sentinel("checkinBooking"),
    checkoutRemainingAssets: h.sentinel("checkoutRemainingAssets"),
    checkoutAssets: h.sentinel("checkoutAssets"),
    checkinAssets: h.sentinel("checkinAssets"),
    partialCheckoutBooking: h.sentinel("partialCheckoutBooking"),
    partialCheckinBooking: h.sentinel("partialCheckinBooking"),
    getDetailedPartialCheckoutData: h.sentinel(
      "getDetailedPartialCheckoutData"
    ),
    getDetailedPartialCheckinData: h.sentinel("getDetailedPartialCheckinData"),
  };
});

// why: the service both fulfil actions call once their guards pass; its
// orchestration per status is pinned in fulfil-and-checkout.server.test.ts.
vi.mock("~/modules/booking/fulfil-and-checkout.server", () => ({
  fulfilAndCheckOut: h.sentinel("fulfilAndCheckOut"),
}));

// why: the fulfil screen's loader reads the outstanding reservations first
// once its guards pass, so that read is its sentinel.
vi.mock("~/utils/booking-model-requests", async () => {
  const actual = await vi.importActual<typeof BookingModelRequests>(
    "~/utils/booking-model-requests"
  );
  return {
    ...actual,
    getOutstandingModelRequests: h.sentinel("getOutstandingModelRequests"),
  };
});

import {
  BOOKING_ID,
  CALLER_ID,
  CHECKINOUT_PATHS,
  ORG_ID,
  checkinoutBooking,
  checkinoutCaller,
  checkinoutCases,
  checkinoutMembership,
  checkinoutOrganization,
  checkinoutSelectedOrganization,
  checkinoutSettings,
  checkinoutWorkingHours,
  roleSetKey,
} from "@helpers/checkinout-cases";
import type {
  CheckinoutCase,
  CheckinoutPath,
  CheckinoutPathKey,
  CheckinoutSentinel,
} from "@helpers/checkinout-cases";
import { action as overviewAction } from "~/routes/_layout+/bookings.$bookingId.overview";
import {
  action as checkinAssetsAction,
  loader as checkinAssetsLoader,
} from "~/routes/_layout+/bookings.$bookingId.overview.checkin-assets";
import {
  action as checkoutAssetsAction,
  loader as checkoutAssetsLoader,
} from "~/routes/_layout+/bookings.$bookingId.overview.checkout-assets";
import {
  action as fulfilAction,
  loader as fulfilLoader,
} from "~/routes/_layout+/bookings.$bookingId.overview.fulfil-and-checkout";
import { action as mobileCheckin } from "~/routes/api+/mobile+/bookings.checkin";
import { action as mobileCheckout } from "~/routes/api+/mobile+/bookings.checkout";
import { action as mobileFulfil } from "~/routes/api+/mobile+/bookings.fulfil-and-checkout";
import { action as mobilePartialCheckin } from "~/routes/api+/mobile+/bookings.partial-checkin";
import { action as mobilePartialCheckout } from "~/routes/api+/mobile+/bookings.partial-checkout";
import { __resetUserRateLimitForTests } from "~/utils/rate-limit.server";

const ORIGIN = "https://app.shelf.nu";
const SCAN = { "assetIds[0]": "asset-1" };

type Handler = (args: never) => Promise<unknown>;

/** Loader/action args for a web route, acting as the caller. */
function webArgs(request: Request) {
  return {
    request,
    params: { bookingId: BOOKING_ID },
    context: { getSession: () => ({ userId: CALLER_ID }) },
  } as never;
}

/** A GET of one of the booking's scanner pages. */
function pageGet(page: string) {
  return new Request(`${ORIGIN}/bookings/${BOOKING_ID}/overview/${page}`);
}

/** A form POST to the booking overview, or to one of its scanner pages. */
function pagePost(page: string, fields: Record<string, string>) {
  const path = page ? `/overview/${page}` : "/overview";
  return new Request(`${ORIGIN}/bookings/${BOOKING_ID}${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
}

/** A JSON POST to a mobile booking endpoint, in the case's workspace. */
function mobilePost(handler: Handler, endpoint: string, body: object) {
  return () =>
    handler({
      request: new Request(
        `${ORIGIN}/api/mobile/bookings/${endpoint}?orgId=${ORG_ID}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer characterization",
          },
          body: JSON.stringify(body),
        }
      ),
      params: {},
      context: {},
    } as never);
}

/** How each path is invoked. Keyed by the full union: a missing path fails to compile. */
const INVOKE: Record<CheckinoutPathKey, () => Promise<unknown>> = {
  "web:overview:checkOut": () =>
    overviewAction(webArgs(pagePost("", { intent: "checkOut" }))),
  "web:overview:checkIn": () =>
    overviewAction(webArgs(pagePost("", { intent: "checkIn" }))),
  "web:overview:checkOutRemaining": () =>
    overviewAction(webArgs(pagePost("", { intent: "checkOutRemaining" }))),
  "web:overview:partial-checkin": () =>
    overviewAction(
      webArgs(pagePost("", { intent: "partial-checkin", ...SCAN }))
    ),
  "web:overview:partial-checkout": () =>
    overviewAction(
      webArgs(pagePost("", { intent: "partial-checkout", ...SCAN }))
    ),
  "web:checkout-assets:loader": () =>
    checkoutAssetsLoader(webArgs(pageGet("checkout-assets"))),
  "web:checkout-assets:action": () =>
    checkoutAssetsAction(webArgs(pagePost("checkout-assets", SCAN))),
  "web:checkin-assets:loader": () =>
    checkinAssetsLoader(webArgs(pageGet("checkin-assets"))),
  "web:checkin-assets:action": () =>
    checkinAssetsAction(webArgs(pagePost("checkin-assets", SCAN))),
  "web:fulfil-and-checkout:loader": () =>
    fulfilLoader(webArgs(pageGet("fulfil-and-checkout"))),
  "web:fulfil-and-checkout:action": () =>
    fulfilAction(webArgs(pagePost("fulfil-and-checkout", SCAN))),
  "mobile:checkin": mobilePost(mobileCheckin, "checkin", {
    bookingId: BOOKING_ID,
  }),
  "mobile:checkout": mobilePost(mobileCheckout, "checkout", {
    bookingId: BOOKING_ID,
  }),
  "mobile:partial-checkin": mobilePost(
    mobilePartialCheckin,
    "partial-checkin",
    {
      bookingId: BOOKING_ID,
      assetIds: ["asset-1"],
    }
  ),
  "mobile:partial-checkout": mobilePost(
    mobilePartialCheckout,
    "partial-checkout",
    { bookingId: BOOKING_ID, assetIds: ["asset-1"] }
  ),
  "mobile:fulfil-and-checkout": mobilePost(
    mobileFulfil,
    "fulfil-and-checkout",
    {
      bookingId: BOOKING_ID,
      assetIds: ["asset-1"],
    }
  ),
};

const arg0 = (args: unknown[]) => (args[0] ?? {}) as Record<string, unknown>;

/** The booking each sentinel was handed, read from its arguments. */
const SENTINEL_BOOKING_ID: Record<
  CheckinoutSentinel,
  (args: unknown[]) => unknown
> = {
  checkoutBooking: (args) => arg0(args).id,
  checkinBooking: (args) => arg0(args).id,
  partialCheckoutBooking: (args) => arg0(args).id,
  partialCheckinBooking: (args) => arg0(args).id,
  checkoutRemainingAssets: (args) => arg0(args).bookingId,
  checkoutAssets: (args) => arg0(args).bookingId,
  checkinAssets: (args) => arg0(args).bookingId,
  getDetailedPartialCheckoutData: (args) => arg0(args).bookingId,
  getDetailedPartialCheckinData: (args) => args[0],
  getOutstandingModelRequests: (args) =>
    (args[0] as Array<{ bookingId: string }>)[0]?.bookingId,
  fulfilAndCheckOut: (args) => arg0(args).bookingId,
};

/**
 * Guard refusals that answer with a status other than 403, named so that no
 * other error can pass as one.
 */
const NON_403_REFUSALS: Partial<Record<CheckinoutPathKey, RegExp>> = {
  // The fulfil screen refuses a booking whose items the caller may not manage
  // with a status-less ShelfError, which answers 500, and a booking that is
  // not in a status it can check out (a DRAFT) with a 400.
  "web:fulfil-and-checkout:loader":
    /not allowed to add assets for this booking|cannot be checked out in its current status/,
};

/**
 * The status and message of whatever a route answered or threw: a Response, a
 * `data()` result, or an error.
 */
function describeAnswer(value: unknown): { status: number; message: string } {
  if (value instanceof Response) return { status: value.status, message: "" };
  if (
    value &&
    typeof value === "object" &&
    "init" in value &&
    "data" in value
  ) {
    const { init, data } = value as {
      init: ResponseInit | null;
      data: { error?: { message?: string } } | null;
    };
    return {
      status: init?.status ?? 200,
      message: data?.error?.message ?? "",
    };
  }
  if (value instanceof Error) {
    const status = (value as { status?: number }).status ?? 500;
    return { status, message: value.message };
  }
  return { status: 200, message: "" };
}

/** Points every fake at the case's rows. */
function applyCase(c: CheckinoutCase) {
  h.state.reached.length = 0;
  h.state.user = checkinoutCaller();
  h.state.selectedOrganization = checkinoutSelectedOrganization(c);
  h.state.membership = checkinoutMembership(c);
  h.state.organization = checkinoutOrganization();
  h.state.booking = checkinoutBooking(c);
  h.state.settings = checkinoutSettings(c.explicit);
  h.state.workingHours = checkinoutWorkingHours();
  // The mobile partial check-in endpoint rate-limits per user; thousands of
  // cases as one user would otherwise start answering 429.
  __resetUserRateLimitForTests();
}

/**
 * Runs one case and names its outcome.
 *
 * @returns `allowed` (plus the explicit flag handed to the fulfil service) or `denied`
 * @throws when the route neither reached its sentinel nor refused through a guard
 */
async function runCase(path: CheckinoutPath, c: CheckinoutCase) {
  applyCase(c);
  const label = `${path.key} | ${c.variant} | ${roleSetKey(c.roles)} | ${
    c.relationship
  } | ${c.status}`;

  let answer: unknown;
  try {
    answer = await INVOKE[path.key]();
  } catch (thrown) {
    answer = thrown;
  }

  if (h.state.reached.length > 0) {
    expect(
      h.state.reached.map((r) => r.name),
      label
    ).toEqual([path.sentinel]);
    const { args } = h.state.reached[0];
    expect(SENTINEL_BOOKING_ID[path.sentinel](args), label).toBe(BOOKING_ID);
    return path.sentinel === "fulfilAndCheckOut"
      ? `allowed (requireExplicitCheckout=${String(
          arg0(args).requireExplicitCheckout
        )})`
      : "allowed";
  }

  const { status, message } = describeAnswer(answer);
  const isGuardRefusal =
    status === 403 || (NON_403_REFUSALS[path.key]?.test(message) ?? false);
  if (!isGuardRefusal) {
    throw new Error(
      `${label}: the sentinel was not reached and no guard refused (answered ${status}: ${
        message || "no message"
      })`
    );
  }
  return "denied";
}

type Tree = { [key: string]: Tree | string };

/** Sets `value` at `keys` in `tree`, creating the branches on the way. */
function record(tree: Tree, keys: string[], value: string) {
  let node = tree;
  for (const key of keys.slice(0, -1)) {
    node = (node[key] ??= {}) as Tree;
  }
  node[keys[keys.length - 1]] = value;
}

const RESULTS: Record<string, unknown> = {};

describe("check-out / check-in paths", () => {
  beforeAll(() => {
    // why: every refused case logs a handled 4xx and every sentinel stop logs
    // an error. Thousands of lines would bury the one failure that matters.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  for (const path of CHECKINOUT_PATHS) {
    it(`${path.key} (${path.kind}, ${path.direction})`, async () => {
      const outcomes: Tree = {};
      const cases = checkinoutCases(path);
      for (const c of cases) {
        record(
          outcomes,
          [c.variant, roleSetKey(c.roles), c.relationship, c.status],
          await runCase(path, c)
        );
      }
      RESULTS[path.key] = {
        specRow: path.specRow,
        surface: path.surface,
        kind: path.kind,
        direction: path.direction,
        sentinel: path.sentinel,
        cases: cases.length,
        outcomes,
      };
    }, 60_000);
  }

  it("matches the committed fixture", async () => {
    expect(Object.keys(RESULTS)).toEqual(CHECKINOUT_PATHS.map((p) => p.key));
    await expect(`${JSON.stringify(RESULTS, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/checkinout-paths.json"
    );
  });
});
