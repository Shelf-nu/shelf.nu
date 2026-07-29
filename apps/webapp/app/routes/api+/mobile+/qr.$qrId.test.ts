import { beforeEach, describe, expect, it, vi } from "vitest";

// why: `mobile-auth.server` transitively loads the Supabase admin client and
// the real Prisma client (no DB / env in unit tests); the loader only calls
// requireMobileAuth from it.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
}));

// why: the resolver's own branching is covered by its co-located test; here
// we only assert how THIS route propagates the resolver's discriminated
// results into the wire payload the companion consumes.
vi.mock("~/modules/api/mobile-code-resolve.server", () => ({
  resolveMobileScannedCode: vi.fn(),
}));

// why: scan provenance writes hit the DB; the contract under test is WHAT the
// route passes to the service (coords included/omitted), not the persistence
// itself — createScan's own behavior is covered by its co-located test.
vi.mock("~/modules/scan/service.server", () => ({
  createScan: vi.fn(),
}));

import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { resolveMobileScannedCode } from "~/modules/api/mobile-code-resolve.server";
import { createScan } from "~/modules/scan/service.server";
import { loader } from "./qr.$qrId";

/**
 * Tests for GET /api/mobile/qr/:qrId:
 * - error-payload propagation — the structured `reason`/`qrId` discriminator
 *   must reach the wire for unclaimed codes, and must be absent for plain
 *   failures (additive contract);
 * - optional scan geolocation — valid `x-shelf-scan-latitude` /
 *   `x-shelf-scan-longitude` HEADERS are forwarded to `createScan` as strings
 *   (web format parity), while invalid / partial / absent coordinates are
 *   silently ignored and NEVER affect the resolve response. Coordinates
 *   deliberately do NOT travel on the query string: a URL reaches access logs,
 *   APM traces and Sentry breadcrumbs, and precise GPS must not.
 *
 * @see {@link file://./qr.$qrId.ts}
 */

/** Shape of the `data()` result the route loader returns. */
type DataResult<T> = { data: T; init: ResponseInit | null };

/**
 * Runs the loader and unwraps the data() envelope.
 *
 * @param qrId - Scanned code id in the path.
 * @param coordinateHeaders - Raw header values for the scan-location headers;
 *   omit a key to leave that header unset.
 */
async function callLoader(
  qrId = "qr-1",
  coordinateHeaders: { latitude?: string; longitude?: string } = {}
) {
  const headers = new Headers();
  if (coordinateHeaders.latitude !== undefined) {
    headers.set("x-shelf-scan-latitude", coordinateHeaders.latitude);
  }
  if (coordinateHeaders.longitude !== undefined) {
    headers.set("x-shelf-scan-longitude", coordinateHeaders.longitude);
  }
  const request = new Request(`http://localhost/api/mobile/qr/${qrId}`, {
    headers,
  });
  const result = await loader({
    request,
    params: { qrId },
    context: {},
  } as never);
  const { data, init } = result as unknown as DataResult<{
    qr?: unknown;
    error?: { message: string; reason?: string; qrId?: string };
  }>;
  return { body: data, status: init?.status ?? 200 };
}

/** A successful resolve with a recordable QR id (provenance IS written). */
function mockOkResolve() {
  const qr = {
    id: "qr-1",
    assetId: "asset-1",
    kitId: null,
    organizationId: "org-1",
    asset: { id: "asset-1" },
    kit: null,
  };
  vi.mocked(resolveMobileScannedCode).mockResolvedValue({
    ok: true,
    qr,
    recordableQrId: "qr-1",
  } as never);
  return qr;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as any);
});

describe("GET /api/mobile/qr/:qrId error payload", () => {
  it("propagates reason + qrId for an unclaimed code and records nothing", async () => {
    vi.mocked(resolveMobileScannedCode).mockResolvedValue({
      ok: false,
      status: 404,
      message: "This QR code is not linked to any organization",
      reason: "unclaimed",
      qrId: "qr-1",
    });

    const { body, status } = await callLoader();

    expect(status).toBe(404);
    expect(body.error).toEqual({
      message: "This QR code is not linked to any organization",
      reason: "unclaimed",
      qrId: "qr-1",
    });
    expect(createScan).not.toHaveBeenCalled();
  });

  it("omits reason/qrId entirely for plain failures (additive contract)", async () => {
    vi.mocked(resolveMobileScannedCode).mockResolvedValue({
      ok: false,
      status: 403,
      message: "This QR code belongs to a different organization",
    });

    const { body, status } = await callLoader();

    expect(status).toBe(403);
    expect(body.error).toEqual({
      message: "This QR code belongs to a different organization",
    });
    expect(body.error).not.toHaveProperty("reason");
    expect(body.error).not.toHaveProperty("qrId");
  });
});

describe("GET /api/mobile/qr/:qrId scan geolocation", () => {
  it("persists valid coordinates on the recorded scan (string format, web parity)", async () => {
    const qr = mockOkResolve();

    const { body, status } = await callLoader("qr-1", {
      latitude: "52.370216",
      longitude: "4.895168",
    });

    expect(status).toBe(200);
    expect(body.qr).toEqual(qr);
    expect(createScan).toHaveBeenCalledWith(
      expect.objectContaining({
        qrId: "qr-1",
        // Stored as strings — the Scan model's columns are String and the web
        // flow posts `position.coords.latitude.toString()`.
        latitude: "52.370216",
        longitude: "4.895168",
      })
    );
  });

  it("ignores out-of-range coordinates and still resolves + records", async () => {
    const qr = mockOkResolve();

    // lat 91 is outside −90..90 → the pair is dropped, nothing else changes.
    const { body, status } = await callLoader("qr-1", {
      latitude: "91",
      longitude: "4.895168",
    });

    expect(status).toBe(200);
    expect(body.qr).toEqual(qr);
    expect(createScan).toHaveBeenCalledTimes(1);
    const args = vi.mocked(createScan).mock.calls[0][0];
    expect(args).not.toHaveProperty("latitude");
    expect(args).not.toHaveProperty("longitude");
  });

  it("ignores non-numeric and empty coordinates (no Null Island 0,0 scans)", async () => {
    mockOkResolve();

    // why: `z.coerce.number()` would turn "" into 0 — assert the schema's
    // empty-string guard actually drops the pair instead of storing 0,0.
    await callLoader("qr-1", { latitude: "", longitude: "" });
    // Non-numeric garbage must also be dropped.
    await callLoader("qr-1", { latitude: "abc", longitude: "4.9" });

    expect(createScan).toHaveBeenCalledTimes(2);
    for (const [args] of vi.mocked(createScan).mock.calls) {
      expect(args).not.toHaveProperty("latitude");
      expect(args).not.toHaveProperty("longitude");
    }
  });

  it("ignores a partial pair — coordinates only make sense together", async () => {
    mockOkResolve();

    await callLoader("qr-1", { latitude: "52.370216" });

    const args = vi.mocked(createScan).mock.calls[0][0];
    expect(args).not.toHaveProperty("latitude");
    expect(args).not.toHaveProperty("longitude");
  });

  it("ignores coordinates sent on the QUERY STRING (they must never be in a URL)", async () => {
    mockOkResolve();

    // Regression guard: coordinates used to ride on `?latitude=&longitude=`,
    // which put precise GPS into every access log / APM trace / Sentry
    // breadcrumb. Only the headers are read now.
    const request = new Request(
      "http://localhost/api/mobile/qr/qr-1?latitude=52.370216&longitude=4.895168"
    );
    await loader({ request, params: { qrId: "qr-1" }, context: {} } as never);

    const args = vi.mocked(createScan).mock.calls[0][0];
    expect(args).not.toHaveProperty("latitude");
    expect(args).not.toHaveProperty("longitude");
  });

  it("resolves and records without coordinates when none are sent", async () => {
    const qr = mockOkResolve();

    const { body, status } = await callLoader();

    expect(status).toBe(200);
    expect(body.qr).toEqual(qr);
    expect(createScan).toHaveBeenCalledWith({
      userAgent: "mobile-companion",
      userId: "user-1",
      qrId: "qr-1",
      deleted: false,
    });
  });
});
