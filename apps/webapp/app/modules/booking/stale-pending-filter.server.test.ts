/**
 * The redirect that drops a "Pending approval" status filter once both
 * approval switches are off: where it sends the request, what it keeps of the
 * query, and that only the bookings index rewrites the saved bookings filter.
 *
 * @see {@link file://./stale-pending-filter.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { redirectFromStalePendingApprovalFilter } from "./stale-pending-filter.server";

// @vitest-environment node

// why: the approval switches are a database read; each test sets them
vi.mock("~/database/db.server", () => ({
  db: { bookingSettings: { findUnique: vi.fn() } },
}));

const APPROVAL_OFF = {
  requireApprovalForBase: false,
  requireApprovalForSelfService: false,
};

/** Runs the helper for a request to `url`. */
function run(url: string, rewriteBookingsFilterCookie?: boolean) {
  const request = new Request(url);
  return redirectFromStalePendingApprovalFilter({
    request,
    organizationId: "org-1",
    searchParams: new URL(url).searchParams,
    rewriteBookingsFilterCookie,
  });
}

describe("redirectFromStalePendingApprovalFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.bookingSettings.findUnique).mockResolvedValue(
      APPROVAL_OFF as never
    );
  });

  it("does nothing without a Pending approval filter", async () => {
    await expect(
      run("http://localhost/me/bookings?status=RESERVED")
    ).resolves.toBeNull();
    expect(db.bookingSettings.findUnique).not.toHaveBeenCalled();
  });

  it("keeps the filter while approval is on", async () => {
    vi.mocked(db.bookingSettings.findUnique).mockResolvedValue({
      requireApprovalForBase: false,
      requireApprovalForSelfService: true,
    } as never);
    await expect(
      run("http://localhost/me/bookings?status=PENDING_APPROVAL")
    ).resolves.toBeNull();
  });

  it("redirects to the same page without the status and page", async () => {
    const res = (await run(
      "http://localhost/kits/kit-1/bookings?status=PENDING_APPROVAL&page=3&s=cam"
    )) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/kits/kit-1/bookings?s=cam");
    // Not the bookings index: its saved filter is left alone.
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("rewrites the saved bookings filter for the bookings index", async () => {
    const res = (await run(
      "http://localhost/bookings?status=PENDING_APPROVAL&orderBy=name",
      true
    )) as Response;

    expect(res.headers.get("Location")).toBe("/bookings?orderBy=name");
    expect(res.headers.get("Set-Cookie")).toContain("bookingFilter");
  });
});
