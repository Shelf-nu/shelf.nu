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

// why: scan provenance writes hit the DB; the route's contract under test is
// the error payload shape, not recording (which stays unchanged).
vi.mock("~/modules/scan/service.server", () => ({
  createScan: vi.fn(),
}));

import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { resolveMobileScannedCode } from "~/modules/api/mobile-code-resolve.server";
import { createScan } from "~/modules/scan/service.server";
import { loader } from "./qr.$qrId";

/**
 * Tests for GET /api/mobile/qr/:qrId error-payload propagation — the
 * structured `reason`/`qrId` discriminator must reach the wire for unclaimed
 * codes, and must be absent for plain failures (additive contract).
 *
 * @see {@link file://./qr.$qrId.ts}
 */

/** Shape of the `data()` result the route loader returns. */
type DataResult<T> = { data: T; init: ResponseInit | null };

/** Runs the loader and unwraps the data() envelope. */
async function callLoader(qrId = "qr-1") {
  const request = new Request(`http://localhost/api/mobile/qr/${qrId}`);
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
