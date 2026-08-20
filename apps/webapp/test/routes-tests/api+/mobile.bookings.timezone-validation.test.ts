import { action as assetAddNoteAction } from "~/routes/api+/mobile+/asset.add-note";
import { action as auditsRecordScanAction } from "~/routes/api+/mobile+/audits.record-scan";
import { action as bookingsArchiveAction } from "~/routes/api+/mobile+/bookings.archive";
import { action as createAction } from "~/routes/api+/mobile+/bookings.create";
import { action as reserveAction } from "~/routes/api+/mobile+/bookings.reserve";
import { action as updateAction } from "~/routes/api+/mobile+/bookings.update";
import { action as custodyReleaseAction } from "~/routes/api+/mobile+/custody.release";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

/**
 * The mobile booking routes accept the IANA zone their caller declares and
 * decode every submitted wall-clock in it, so an unrecognised zone has to be
 * rejected at the boundary.
 *
 * These cases pin the OBSERVABLE contract: HTTP 400 plus a message naming the
 * timezone field. That matters because the failure mode being guarded against
 * is a 500 — a bare `schema.parse()` throws a `ZodError`, which `makeShelfError`
 * does not recognise, so it becomes "Sorry, something went wrong." with a Sentry
 * capture. `~/utils/error` is deliberately NOT mocked here: the real
 * `ShelfError` / `makeShelfError` are the behaviour under test.
 */

// why: Remix's data() returns a plain object in tests; wrap it in a Response so
// the assertions can read the real HTTP status the route produced.
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: external auth — these gates run before body validation and would
// otherwise hit Supabase.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  assertMobileCanUseBookings: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: rate limiting runs before validation and talks to its backing store.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn(),
}));

// why: `db.server` runs `void db.$connect()` at module load, which throws an
// unhandled P1001 in the node environment when nothing mocks it.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: imported at module load by the routes under test; never reached here,
// but they pull in the database client if left real.
vi.mock("~/modules/booking/service.server", () => ({
  createBooking: vi.fn(),
  updateBasicBooking: vi.fn(),
  // reserve's imports — unreachable in these cases (validation or the booking
  // lookup answers first), but declared so the mock mirrors the real module.
  reserveBooking: vi.fn(),
  getBookingFlags: vi.fn(),
}));
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn(),
}));
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vi.fn(),
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";

/** Builds a POST request carrying `body` as JSON. */
function jsonRequest(body: Record<string, unknown>) {
  return new Request("https://example.com/api/mobile/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A body that is valid apart from whatever `overrides` changes. */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    bookingId: "booking-1",
    name: "Some booking",
    custodianTeamMemberId: "tm-1",
    startDate: "2026-08-20T09:00",
    endDate: "2026-08-20T17:00",
    timeZone: "America/Chicago",
    tags: [],
    ...overrides,
  };
}

describe("mobile booking routes - declared timezone validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMobileAuth).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1" as any);
    vi.mocked(getMobileUserContext).mockResolvedValue({
      role: "ADMIN",
    } as any);
  });

  const routes = [
    { name: "create", action: createAction },
    { name: "reserve", action: reserveAction },
    { name: "update", action: updateAction },
  ];

  for (const route of routes) {
    describe(route.name, () => {
      it("rejects an unrecognised IANA zone with 400, not 500", async () => {
        const response = (await route.action(
          createActionArgs({
            request: jsonRequest(validBody({ timeZone: "Not/AZone" })),
          })
        )) as unknown as Response;

        expect(response.status).toBe(400);

        const payload = await response.json();
        expect(payload.error.message).toContain("valid IANA zone");
        // The generic message is what a 500 would have produced.
        expect(payload.error.message).not.toContain("something went wrong");
      });

      it("rejects an empty zone with 400", async () => {
        const response = (await route.action(
          createActionArgs({
            request: jsonRequest(validBody({ timeZone: "" })),
          })
        )) as unknown as Response;

        expect(response.status).toBe(400);

        const payload = await response.json();
        expect(payload.error.message).toContain("Time zone");
      });

      it("rejects an unparseable JSON body with 400", async () => {
        // `request.json()` throws a SyntaxError, which reaches the same generic
        // 500 branch as an unhandled ZodError unless the helper owns the parse.
        const request = new Request("https://example.com/api/mobile/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{not json",
        });

        const response = (await route.action(
          createActionArgs({ request })
        )) as unknown as Response;

        expect(response.status).toBe(400);

        const payload = await response.json();
        expect(payload.error.message).not.toContain("something went wrong");
      });

      it("accepts a real IANA zone past body validation", async () => {
        // Not asserting a 2xx — the request goes on to hit collaborators this
        // suite deliberately does not set up. What matters is that a valid zone
        // does NOT produce the timezone 400 the cases above assert.
        const response = (await route.action(
          createActionArgs({
            request: jsonRequest(validBody({ timeZone: "Europe/Amsterdam" })),
          })
        )) as unknown as Response;

        const payload = await response.json();
        expect(payload?.error?.message ?? "").not.toContain("IANA zone");
      });
    });
  }
});

/**
 * The malformed-body contract, one representative route per domain.
 *
 * `parseMobileBody` was applied across 19 mobile routes; asserting all of them
 * would be ceremony. What these pin is that the helper is wired at each domain's
 * boundary and that the shared behaviour holds — an unparseable body answers 400
 * rather than the generic 500 + Sentry capture the bare `schema.parse()` produced.
 *
 * `~/utils/error` is not mocked, for the same reason as the suite above: the real
 * status is the thing under test.
 */
describe("mobile routes - malformed body returns 400", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMobileAuth).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1" as any);
    // `canUseAudits` gates the audit routes with a 403 BEFORE they parse the
    // body, so it has to be satisfied for these cases to reach the parse.
    vi.mocked(getMobileUserContext).mockResolvedValue({
      role: "ADMIN",
      canUseAudits: true,
    } as any);
  });

  /** A body that is not valid JSON at all. */
  function malformedRequest() {
    return new Request("https://example.com/api/mobile/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
  }

  const representatives = [
    { domain: "asset", action: assetAddNoteAction },
    { domain: "audit", action: auditsRecordScanAction },
    { domain: "booking", action: bookingsArchiveAction },
    { domain: "custody", action: custodyReleaseAction },
  ];

  for (const { domain, action } of representatives) {
    it(`${domain}: answers 400, not the generic 500`, async () => {
      const response = (await action(
        createActionArgs({ request: malformedRequest() })
      )) as unknown as Response;

      expect(response.status).toBe(400);

      const payload = await response.json();
      expect(payload.error.message).not.toContain("something went wrong");
    });
  }
});
