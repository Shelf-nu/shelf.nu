/**
 * Tests for the page title fetch's failure handling.
 *
 * Every failure reads as UNREACHABLE, permanent only for a refused host. A
 * failure the guarded fetch reports (a ShelfError) is expected and stays
 * quiet; anything else is a fault in this code and is logged.
 *
 * @see {@link file://./fetch-title.server.ts}
 */
import { parseLink } from "@shelf/links";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import type * as Ssrf from "~/utils/ssrf.server";
import { BlockedAddressError, safeFetchPrefix } from "~/utils/ssrf.server";
import { fetchPageTitle } from "./fetch-title.server";

// @vitest-environment node

// why: the guarded fetch makes real network requests; each test decides how
// it fails. BlockedAddressError stays real so `instanceof` checks hold.
vi.mock("~/utils/ssrf.server", async (importOriginal) => {
  const actual = await importOriginal<typeof Ssrf>();
  return { ...actual, safeFetchPrefix: vi.fn() };
});

// why: spying on Logger to assert the log without pino or Sentry
vi.mock("~/utils/logger", () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const link = parseLink("https://files.example.com/manual.pdf")!;

describe("fetchPageTitle failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is UNREACHABLE for now, without a log, when the request fails", async () => {
    vi.mocked(safeFetchPrefix).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Request timed out",
        label: "Link preview",
      })
    );

    await expect(fetchPageTitle(link)).resolves.toEqual({
      outcome: "UNREACHABLE",
      permanent: false,
    });
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it("is UNREACHABLE for good, without a log, for a refused host", async () => {
    vi.mocked(safeFetchPrefix).mockRejectedValue(
      new BlockedAddressError("files.example.com", "10.0.0.1")
    );

    await expect(fetchPageTitle(link)).resolves.toEqual({
      outcome: "UNREACHABLE",
      permanent: true,
    });
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it("logs an unexpected error with the link's host", async () => {
    vi.mocked(safeFetchPrefix).mockRejectedValue(new TypeError("boom"));

    await expect(fetchPageTitle(link)).resolves.toEqual({
      outcome: "UNREACHABLE",
      permanent: false,
    });
    expect(Logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Logger.error).mock.calls[0][0]).toMatchObject({
      additionalData: { host: "files.example.com" },
    });
  });
});
