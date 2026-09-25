/**
 * Route tests for `api+/bookings.create-for-models.ts`.
 *
 * Pins the three things the endpoint exists to get right: model ids are proven
 * to belong to the caller's workspace before anything is written, the chosen
 * quantities reach `createBooking` as reservations rather than assets, and a
 * submission with no models is refused.
 *
 * The real `parseData`, `BookingFormSchema` and org guard run — only the
 * service layer and the org's settings are stubbed — so these cases also pin
 * the wire shape the dialog posts (`models[i].assetModelId` /
 * `models[i].quantity`, alongside the booking's own fields).
 */

import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBooking } from "~/modules/booking/service.server";
import { action } from "~/routes/api+/bookings.create-for-models";
import { requirePermission } from "~/utils/roles.server";

const dbMocks = vi.hoisted(() => ({
  assetModelFindMany: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  createBooking: vi.fn(),
  getTeamMember: vi.fn(),
}));

// why: the org guard reads AssetModel rows directly through prisma; injecting
// the result is how each case decides whether a submitted id is in the org.
vi.mock("~/database/db.server", () => ({
  db: {
    assetModel: {
      findMany: dbMocks.assetModelFindMany,
    },
  },
}));

// why: each case supplies the (organizationId, role, isSelfServiceOrBase) it
// needs rather than running the real permission machinery.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the reservation write is covered by the booking service's own tests;
// here the question is only what the route hands it.
vi.mock("~/modules/booking/service.server", () => ({
  createBooking: serviceMocks.createBooking,
}));

// why: custodian org-scoping is the booking service's shared guard, stubbed so
// these cases stay about the models.
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: serviceMocks.getTeamMember,
}));

// why: tag building is a pure string split the route does not own.
vi.mock("~/modules/tag/service.server", () => ({
  buildTagsSet: vi.fn(() => ({ set: [] })),
}));

// why: working hours disabled keeps the real date schema focused on the one
// rule these cases need it to enforce — that a start date is in the future.
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn().mockResolvedValue({
    enabled: false,
    weeklySchedule: {},
    overrides: [],
  }),
}));

// why: no buffer, no tag requirement and no length cap, so a well-formed
// submission is accepted on its own merits.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    bufferStartTime: 0,
    tagsRequired: false,
    maxBookingLength: null,
    maxBookingLengthSkipClosedDays: false,
  }),
}));

// why: the submitted wall-clock dates are read in this zone, so fixtures can
// be built in UTC and mean what they say.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({
    dateFormat: "MM_DD_YYYY",
    timeFormat: "H12",
    weekStartsOn: 0,
    timeZone: "UTC",
  }),
}));

// why: the route only needs a timezone hint; the real header parsing is not
// under test.
vi.mock("~/utils/client-hints", () => ({
  getClientHint: vi.fn(() => ({ timeZone: "UTC", locale: "en-US" })),
}));

// why: notifications are a side effect, not part of the contract under test.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: data() and redirect() return real Responses so the action can be
// invoked directly and its status asserted without a Remix runtime.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
    redirect: vi.fn(() => new Response(null, { status: 302 })),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);
const createBookingMock = vi.mocked(createBooking);

/** A custodian the caller's org owns, as the picker submits it. */
const CUSTODIAN = { id: "team-member-1", name: "Alex Doe" };

/**
 * A wall-clock `datetime-local` value a whole number of days from now.
 *
 * Computed rather than hard-coded so the "start date must be in the future"
 * rule keeps meaning the same thing as the calendar moves past any literal a
 * fixture could carry.
 *
 * @param daysAhead - How far ahead to place the value
 * @returns A `YYYY-MM-DDTHH:mm` string, read by the schema as UTC
 */
function futureWallClock(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

/**
 * Builds the POST the dialog sends.
 *
 * The body is a `URLSearchParams`, not a `FormData`: happy-dom drops empty
 * fields from a FormData on the Request round-trip, which would silently
 * change what the route is asked to parse.
 *
 * @param body.models - One entry per model, posted as indexed fields
 * @returns The request to hand the action
 */
function post(body: {
  name?: string;
  from?: string;
  to?: string;
  custodian?: { id: string; name: string };
  models?: { assetModelId: string; quantity: number }[];
}) {
  const params = new URLSearchParams();

  if (body.name !== undefined) params.set("name", body.name);
  if (body.from !== undefined) params.set("startDate", body.from);
  if (body.to !== undefined) params.set("endDate", body.to);
  if (body.custodian !== undefined) {
    params.set("custodian", JSON.stringify(body.custodian));
  }

  (body.models ?? []).forEach((model, index) => {
    params.set(`models[${index}].assetModelId`, model.assetModelId);
    params.set(`models[${index}].quantity`, String(model.quantity));
  });

  return new Request("https://example.com/api/bookings/create-for-models", {
    method: "POST",
    body: params,
  });
}

/** The action args around a request, with a signed-in user. */
function buildArgs(request: Request): ActionFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request,
    params: {},
  } as unknown as ActionFunctionArgs;
}

/** A submission whose booking fields are all valid. */
function validBookingFields() {
  return {
    name: "Autumn shoot",
    from: futureWallClock(1),
    to: futureWallClock(2),
    custodian: CUSTODIAN,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  requirePermissionMock.mockResolvedValue({
    organizationId: "org-1",
    currentOrganization: { id: "org-1", type: "TEAM" },
    role: OrganizationRoles.ADMIN,
    isSelfServiceOrBase: false,
  } as never);

  serviceMocks.getTeamMember.mockResolvedValue({
    id: CUSTODIAN.id,
    userId: "user-1",
  });

  createBookingMock.mockResolvedValue({ id: "booking-1" } as never);
});

describe("api/bookings/create-for-models", () => {
  it("refuses a model id from another organization", async () => {
    // why: an id the caller submitted proves nothing about which workspace it
    // belongs to; the guard's count-compare is what turns an empty result into
    // a refusal.
    dbMocks.assetModelFindMany.mockResolvedValue([]);

    const response = await action(
      buildArgs(
        post({
          ...validBookingFields(),
          models: [{ assetModelId: "foreign-model", quantity: 1 }],
        })
      )
    );

    expect((response as unknown as Response).status).toBe(400);
    expect(createBookingMock).not.toHaveBeenCalled();
  });

  it("passes the chosen quantities through to createBooking", async () => {
    dbMocks.assetModelFindMany.mockResolvedValue([
      { id: "am1" },
      { id: "am2" },
    ]);

    const response = await action(
      buildArgs(
        post({
          ...validBookingFields(),
          models: [
            { assetModelId: "am1", quantity: 2 },
            { assetModelId: "am2", quantity: 5 },
          ],
        })
      )
    );

    expect((response as unknown as Response).status).toBe(302);
    expect(vi.mocked(redirect)).toHaveBeenCalledWith(
      "/bookings/booking-1/overview"
    );

    const [args] = createBookingMock.mock.calls[0];
    expect(args.modelRequests).toEqual([
      { assetModelId: "am1", quantity: 2 },
      { assetModelId: "am2", quantity: 5 },
    ]);
    // why: reservations are not assets — sending asset ids here would create a
    // booking holding concrete units the user never picked.
    expect(args.assetIds).toEqual([]);
  });

  it("rejects a submission with no models", async () => {
    dbMocks.assetModelFindMany.mockResolvedValue([]);

    const response = await action(
      buildArgs(post({ ...validBookingFields(), models: [] }))
    );

    expect((response as unknown as Response).status).toBe(400);
    expect(createBookingMock).not.toHaveBeenCalled();
    // why: an empty list is refused by the schema, before any workspace lookup
    // — a submission with nothing in it never reaches the database.
    expect(dbMocks.assetModelFindMany).not.toHaveBeenCalled();
  });
});
