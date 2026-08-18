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
import { loader } from "~/routes/api+/mobile+/qr.$qrId";

/**
 * Tests for GET /api/mobile/qr/:qrId:
 * - error-payload propagation — the structured `reason`/`qrId` discriminator
 *   must reach the wire for unclaimed codes, and must be absent for plain
 *   failures (additive contract);
 * - optional scan geolocation — valid `X-Scan-Latitude`/`X-Scan-Longitude` headers are
 *   forwarded to `createScan` as strings (web format parity), while invalid /
 *   partial / absent coordinates are silently ignored and NEVER affect the
 *   resolve response.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/qr.$qrId.ts}
 */

/** Shape of the `data()` result the route loader returns. */
type DataResult<T> = { data: T; init: ResponseInit | null };

/** Runs the loader and unwraps the data() envelope. */
async function callLoader(
  qrId = "qr-1",
  search = "",
  headers?: Record<string, string>
) {
  const request = new Request(
    `http://localhost/api/mobile/qr/${qrId}${search}`,
    {
      headers,
    }
  );
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

    const { body, status } = await callLoader("qr-1", "", {
      // Mixed casing on purpose: Headers.get is case-insensitive, so the
      // route must accept however the client capitalizes them.
      "X-Scan-Latitude": "52.370216",
      "x-scan-longitude": "4.895168",
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
    const { body, status } = await callLoader("qr-1", "", {
      "X-Scan-Latitude": "91",
      "X-Scan-Longitude": "4.895168",
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
    await callLoader("qr-1", "", {
      "X-Scan-Latitude": "",
      "X-Scan-Longitude": "",
    });
    // Non-numeric garbage must also be dropped.
    await callLoader("qr-1", "", {
      "X-Scan-Latitude": "abc",
      "X-Scan-Longitude": "4.9",
    });

    expect(createScan).toHaveBeenCalledTimes(2);
    for (const [args] of vi.mocked(createScan).mock.calls) {
      expect(args).not.toHaveProperty("latitude");
      expect(args).not.toHaveProperty("longitude");
    }
  });

  it("ignores a partial pair — coordinates only make sense together", async () => {
    mockOkResolve();

    await callLoader("qr-1", "?latitude=52.370216");

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
