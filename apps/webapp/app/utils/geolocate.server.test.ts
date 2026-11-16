/**
 * Geocoding an address through Nominatim.
 *
 * The call is third-party and sits inside a user-facing loader, so it needs a
 * deadline of its own. Without one a hung upstream holds the request open for as
 * long as the connection lasts, and every held request holds whatever it had
 * already taken with it.
 *
 * @see {@link file://./geolocate.server.ts}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GEOCODING_TIMEOUT_MS, geolocate } from "./geolocate.server";

// why: the config supplies only a User-Agent string, and reading the real one
// would drag the whole app config into a unit test.
vi.mock("~/config/shelf.config", () => ({
  config: { geocoding: { userAgent: "shelf-test" } },
}));

describe("geolocate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // why: console noise only; the helper logs failures deliberately.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns coordinates for a resolved address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ lat: "52.37", lon: "4.89" }]),
      })
    );

    await expect(geolocate("Amsterdam")).resolves.toEqual({
      lat: 52.37,
      lon: 4.89,
    });
  });

  it("passes an abort signal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ lat: "1", lon: "2" }]),
    });
    vi.stubGlobal("fetch", fetchMock);

    await geolocate("Amsterdam");

    const [, init] = fetchMock.mock.calls[0];
    // Without a signal there is nothing to cancel, so a hung upstream is held
    // for the lifetime of the connection.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives the request a deadline, and it fires", async () => {
    vi.useFakeTimers();

    let captured: AbortSignal | undefined;
    // A fetch that settles only when its signal aborts, which is what a hung
    // upstream looks like from here.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: { signal: AbortSignal }) => {
        captured = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted"))
          );
        });
      })
    );

    const pending = geolocate("Amsterdam");

    // Asserting on the signal itself is what makes this test able to fail: with
    // no deadline there is no signal to capture, so this line catches it rather
    // than the resolved value, which is null either way.
    expect(captured?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(GEOCODING_TIMEOUT_MS + 1);

    expect(captured?.aborted).toBe(true);
    // Null rather than a throw: callers treat "no coordinates" as a normal
    // answer and must not fail the page over a third-party outage.
    await expect(pending).resolves.toBeNull();

    vi.useRealTimers();
  });

  it("answers null without calling out for a blank address", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(geolocate("")).resolves.toBeNull();
    await expect(geolocate(null)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers null when the upstream reports an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 })
    );

    await expect(geolocate("Amsterdam")).resolves.toBeNull();
  });

  it("answers null when the address matches nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );

    await expect(geolocate("nowhere at all")).resolves.toBeNull();
  });
});
