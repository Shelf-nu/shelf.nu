/**
 * Window-keyed asset-model availability endpoint: route tests
 *
 * This endpoint answers the model view's create-booking dialog, where no
 * booking exists yet and the window arrives in the query string. Two properties
 * carry the whole contract and neither is visible from the outside:
 *
 * - **No window, no figures.** Without both dates the availability maths counts
 *   every active booking as competing for the pool, so the number it returns is
 *   the worst case rather than a neutral one. Sent as "available" it is a wrong
 *   answer that looks exactly like a right one, so the endpoint answers with no
 *   rows and does not reach the service at all.
 * - **Model ids are request input.** They arrive from a bulk selection and prove
 *   nothing about which workspace they belong to, so a foreign id must never
 *   reach the availability maths.
 *
 * The asset-model lookup is stood in for by a small table filtered with the
 * `where` clause the route builds, so an org scope dropped from that clause
 * genuinely surfaces the foreign row here instead of being asserted away.
 *
 * @see {@link file://./../../../app/routes/api+/asset-models.availability.ts}
 * @see {@link file://./../../../app/routes/api+/bookings.$bookingId.model-availability.ts} The same question, for a booking that exists
 */
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { loader } from "~/routes/api+/asset-models.availability";

// why: the real single-fetch `data()` does not return an inspectable Response,
// and every assertion below reads the JSON body the caller would receive.
vitest.mock("react-router", async () => {
  const actual = await vitest.importActual("react-router");
  return {
    ...actual,
    data: vitest.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

// why: the real resolver performs DB reads and session work. These tests assert
// what the loader does with a resolved organization, not how it is derived.
vitest.mock("~/utils/roles.server", () => ({
  requirePermission: vitest.fn(),
}));

// why: the wall-clock dates are read in the acting user's preference zone, and
// the real resolver reads that preference from the database.
vitest.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vitest.fn(),
}));

// why: the route only forwards a timezone hint to the preference resolver, and
// the real header and cookie parsing is not what these tests are about.
vitest.mock("~/utils/client-hints", () => ({
  getClientHint: vitest.fn(() => ({ timeZone: "UTC", locale: "en-US" })),
}));

// why: the real client needs a Postgres connection. The implementation set in
// `beforeEach` filters a fixture table with the route's own `where` clause, so
// an org scope missing from that clause returns the foreign row for real.
vitest.mock("~/database/db.server", () => ({
  db: { assetModel: { findMany: vitest.fn() } },
}));

// why: the availability maths runs several aggregates against Postgres and has
// its own tests. Here it is the seam whose CALLS are under assertion.
vitest.mock("~/modules/booking-model-request/service.server", () => ({
  getAssetModelAvailability: vitest.fn(),
}));

import { db } from "~/database/db.server";
import { getAssetModelAvailability } from "~/modules/booking-model-request/service.server";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { requirePermission } from "~/utils/roles.server";

const context = {
  getSession: () => ({ userId: "user-1" }),
} as never;

/** The asset models the stubbed lookup knows about, across two workspaces. */
const MODEL_TABLE = [
  { id: "model-1", organizationId: "org-1" },
  { id: "model-2", organizationId: "org-1" },
  { id: "foreign-model", organizationId: "org-2" },
];

/** The stubbed model lookup, typed as the stand-in rather than as Prisma. */
const modelLookup = db.assetModel.findMany as ReturnType<typeof vitest.fn>;

/** The clause the route builds, as the stubbed lookup reads it. */
type ModelLookupArgs = {
  where: { id: { in: string[] }; organizationId: string };
};

/**
 * Builds a request to this endpoint.
 *
 * `URLSearchParams` rather than a concatenated string: the wall-clock dates
 * carry a `:` of their own, and the model ids repeat under one key, both of
 * which have to survive the round trip encoded.
 *
 * @param args.from - The `from` query value, omitted when absent
 * @param args.to - The `to` query value, omitted when absent
 * @param args.assetModelIds - One `assetModelId` parameter per entry
 * @returns The request the loader receives
 */
function request({
  from,
  to,
  assetModelIds = ["model-1"],
}: {
  from?: string;
  to?: string;
  assetModelIds?: string[];
}) {
  const search = new URLSearchParams();
  if (from !== undefined) search.set("from", from);
  if (to !== undefined) search.set("to", to);
  for (const id of assetModelIds) {
    search.append("assetModelId", id);
  }

  return new Request(
    `https://x.test/api/asset-models/availability?${search.toString()}`
  );
}

/** The response body, as the dialog reads it. */
type Body = {
  error: { message: string } | null;
  from?: string;
  to?: string;
  models?: {
    assetModelId: string;
    alreadyReserved: number;
    available: number;
  }[];
};

/**
 * Runs the loader and parses its response body.
 *
 * @param args - Passed to {@link request}
 * @returns The parsed payload
 */
async function load(args: Parameters<typeof request>[0]): Promise<Body> {
  const response = (await loader({
    context,
    request: request(args),
    params: {},
  } as never)) as unknown as Response;

  return (await response.json()) as Body;
}

describe("asset-model window availability endpoint", () => {
  beforeEach(() => {
    // Call history, not just return values: the assertions below read
    // `.mock.calls`, which without this carry the previous test's calls.
    vitest.clearAllMocks();

    vitest.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
    } as never);

    vitest.mocked(resolveUserFormatPrefsById).mockResolvedValue({
      timeZone: "Asia/Tokyo",
    } as never);

    // The route's clause, applied for real: `{ id: { in }, organizationId }`.
    modelLookup.mockImplementation((args: ModelLookupArgs) =>
      Promise.resolve(
        MODEL_TABLE.filter(
          (model) =>
            args.where.id.in.includes(model.id) &&
            model.organizationId === args.where.organizationId
        ).map((model) => ({ id: model.id }))
      )
    );

    vitest
      .mocked(getAssetModelAvailability)
      .mockResolvedValue({ available: 7 } as never);
  });

  it("answers with no rows and measures nothing when both dates are missing", async () => {
    const body = await load({ assetModelIds: ["model-1", "model-2"] });

    // `payload()` stamps `error: null` onto every success, so the presence of
    // the key says nothing. Read its value.
    expect(body.error).toBeNull();
    expect(body.models).toEqual([]);
    // Not even the model lookup: there is no figure worth computing without a
    // window, so nothing about this request reaches the database.
    expect(modelLookup).not.toHaveBeenCalled();
    expect(vitest.mocked(getAssetModelAvailability)).not.toHaveBeenCalled();
  });

  it("answers with no rows when only the start date is given", async () => {
    const body = await load({ from: "2026-10-01T09:00" });

    expect(body.models).toEqual([]);
    // A half window is the case that makes the overlap predicate empty, which
    // is where a worst-case figure gets dressed up as an answer.
    expect(vitest.mocked(getAssetModelAvailability)).not.toHaveBeenCalled();
  });

  it("answers with no rows when only the end date is given", async () => {
    const body = await load({ to: "2026-10-02T17:00" });

    expect(body.models).toEqual([]);
    expect(vitest.mocked(getAssetModelAvailability)).not.toHaveBeenCalled();
  });

  it("answers with no rows when a date cannot be read", async () => {
    const body = await load({ from: "not-a-date", to: "2026-10-02T17:00" });

    expect(body.models).toEqual([]);
    expect(vitest.mocked(getAssetModelAvailability)).not.toHaveBeenCalled();
  });

  it("answers with no rows when the window ends at or before it starts", async () => {
    const body = await load({
      from: "2026-10-02T17:00",
      to: "2026-10-01T09:00",
    });

    expect(body.models).toEqual([]);
    expect(vitest.mocked(getAssetModelAvailability)).not.toHaveBeenCalled();
  });

  it("leaves a model from another workspace out of the answer", async () => {
    const body = await load({
      from: "2026-10-01T09:00",
      to: "2026-10-02T17:00",
      assetModelIds: ["model-1", "foreign-model"],
    });

    // Absent, not zero: a row the caller cannot act on has no honest figure to
    // show, and a zero would read as "none free" rather than "not yours".
    expect(body.models?.map((row) => row.assetModelId)).toEqual(["model-1"]);
    // The maths must never see the foreign id at all.
    const measuredIds = vitest
      .mocked(getAssetModelAvailability)
      .mock.calls.map(([args]) => args.assetModelId);
    expect(measuredIds).toEqual(["model-1"]);
  });

  it("scopes the lookup to the organization the permission resolved, never one the request names", async () => {
    const body = await load({
      from: "2026-10-01T09:00",
      to: "2026-10-02T17:00",
      assetModelIds: ["foreign-model"],
    });

    expect(body.models).toEqual([]);

    const [lookupArgs] = modelLookup.mock.calls[0] as [ModelLookupArgs];
    expect(lookupArgs.where.organizationId).toBe("org-1");
  });

  it("measures each model over the window, echoing the dates it was asked about", async () => {
    const body = await load({
      from: "2026-10-01T09:00",
      to: "2026-10-02T17:00",
      assetModelIds: ["model-1", "model-2"],
    });

    // Echoed exactly as asked, which is what lets the dialog discard an answer
    // describing dates the user has already changed.
    expect(body.from).toBe("2026-10-01T09:00");
    expect(body.to).toBe("2026-10-02T17:00");
    expect(body.models).toEqual([
      { assetModelId: "model-1", alreadyReserved: 0, available: 7 },
      { assetModelId: "model-2", alreadyReserved: 0, available: 7 },
    ]);
  });

  it("reads the wall-clock dates in the acting user's preference zone", async () => {
    await load({ from: "2026-10-01T09:00", to: "2026-10-02T17:00" });

    const [args] = vitest.mocked(getAssetModelAvailability).mock.calls[0];
    // 09:00 in Asia/Tokyo is 00:00Z. Parsed in the server's own zone instead,
    // the hint would measure a window hours away from the one the create action
    // stores.
    expect(args.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(args.to?.toISOString()).toBe("2026-10-02T08:00:00.000Z");
  });

  it("excludes no booking from the reserved sums, because none exists yet", async () => {
    await load({ from: "2026-10-01T09:00", to: "2026-10-02T17:00" });

    const [args] = vitest.mocked(getAssetModelAvailability).mock.calls[0];
    // A real booking id here would subtract that booking's holdings from the
    // pool the new one has to fit into, reporting more units than are free.
    expect(args.bookingId).toBe("");
    expect(args.organizationId).toBe("org-1");
  });
});
