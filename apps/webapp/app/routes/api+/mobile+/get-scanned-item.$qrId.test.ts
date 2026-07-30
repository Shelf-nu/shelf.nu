import { beforeEach, describe, expect, it, vi } from "vitest";

// why: `mobile-auth.server` transitively loads the Supabase admin client and
// the real Prisma client (no DB / env in unit tests); the loader only calls
// requireMobileAuth from it.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
}));

// why: the resolver's own branching is covered by its co-located test; here
// we only assert how the audit-scanner route propagates the discriminated
// results — the reason field must be additive (same status + message).
vi.mock("~/modules/api/mobile-code-resolve.server", () => ({
  resolveMobileScannedCode: vi.fn(),
}));

import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { resolveMobileScannedCode } from "~/modules/api/mobile-code-resolve.server";
import { loader } from "./get-scanned-item.$qrId";

/**
 * Tests for GET /api/mobile/get-scanned-item/:qrId error-payload propagation.
 * The audit scanner consumes this route: an unclaimed code must still be the
 * exact same 404 + message it always was, with `reason`/`qrId` strictly
 * additive on top.
 *
 * @see {@link file://./get-scanned-item.$qrId.ts}
 */

/** Shape of the `data()` result the route loader returns. */
type DataResult<T> = { data: T; init: ResponseInit | null };

/** Runs the loader and unwraps the data() envelope. */
async function callLoader(qrId = "qr-1") {
  const request = new Request(
    `http://localhost/api/mobile/get-scanned-item/${qrId}`
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as any);
});

describe("GET /api/mobile/get-scanned-item/:qrId error payload", () => {
  it("keeps the audit-scanner 404 contract for unclaimed codes, with reason additive", async () => {
    vi.mocked(resolveMobileScannedCode).mockResolvedValue({
      ok: false,
      status: 404,
      message: "This QR code is not linked to any organization",
      reason: "unclaimed",
      qrId: "qr-1",
    });

    const { body, status } = await callLoader();

    // Unchanged for existing callers: same status, same message.
    expect(status).toBe(404);
    expect(body.error?.message).toBe(
      "This QR code is not linked to any organization"
    );
    // Additive discriminator for reason-aware callers.
    expect(body.error?.reason).toBe("unclaimed");
    expect(body.error?.qrId).toBe("qr-1");
  });

  it("omits reason/qrId entirely for plain failures (additive contract)", async () => {
    vi.mocked(resolveMobileScannedCode).mockResolvedValue({
      ok: false,
      status: 404,
      message: "QR code not found",
    });

    const { body, status } = await callLoader();

    expect(status).toBe(404);
    expect(body.error).toEqual({ message: "QR code not found" });
    expect(body.error).not.toHaveProperty("reason");
    expect(body.error).not.toHaveProperty("qrId");
  });
});
