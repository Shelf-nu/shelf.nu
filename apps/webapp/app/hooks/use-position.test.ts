/**
 * Tests for {@link usePosition} (`~/hooks/use-position`).
 *
 * The hook reports where a QR scan happened: it asks the browser for a fix and
 * posts it against the `scanId` in the URL. The position lives in a module
 * atom shared by every instance — the `qr+` layout and its child route both
 * mount the hook for one scan — so the case that matters here is what a second
 * scan does with a fix that belongs to the first one.
 *
 * @see {@link file://./use-position.ts}
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submit = vi.fn();
const searchParamsValue = { current: new URLSearchParams() };

// why: the hook reads the scanId from the URL and posts through a router
// fetcher; both are router-owned, and the assertion is about what gets posted.
vi.mock("react-router", () => ({
  useFetcher: () => ({ submit }),
  useParams: () => ({ qrId: "qr-1" }),
}));
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [searchParamsValue.current],
}));

import { usePosition } from "./use-position";

/** A fix the browser would hand back, with only the fields the hook posts. */
const coordsFor = (latitude: number, longitude: number) =>
  ({ latitude, longitude }) as GeolocationCoordinates;

describe("usePosition", () => {
  let getCurrentPosition: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    submit.mockClear();
    getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the fix it was given for the scan in the url", async () => {
    searchParamsValue.current = new URLSearchParams({ scanId: "scan-1" });
    getCurrentPosition.mockImplementation((onSuccess: PositionCallback) =>
      onSuccess({ coords: coordsFor(1, 2) } as GeolocationPosition)
    );

    renderHook(() => usePosition());

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        { latitude: "1", longitude: "2", scanId: "scan-1" },
        expect.objectContaining({ method: "post" })
      )
    );
  });

  it("does not post an earlier scan's fix when this scan gets none", async () => {
    // The first scan records a fix, which stays in the shared atom.
    searchParamsValue.current = new URLSearchParams({ scanId: "scan-1" });
    getCurrentPosition.mockImplementation((onSuccess: PositionCallback) =>
      onSuccess({ coords: coordsFor(1, 2) } as GeolocationPosition)
    );
    const first = renderHook(() => usePosition());
    await waitFor(() => expect(submit).toHaveBeenCalled());
    first.unmount();

    // The second scan asks and never hears back — a denied prompt, or a
    // timeout indoors. Its record must stay empty rather than inherit a
    // position from wherever the previous scan happened.
    submit.mockClear();
    searchParamsValue.current = new URLSearchParams({ scanId: "scan-2" });
    getCurrentPosition.mockImplementation(() => undefined);

    renderHook(() => usePosition());

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Assert on what was posted, not how often: the hook mounts on both the
    // `qr+` layout and its child, so one scan legitimately submits more than
    // once. What must never happen is a payload for this scan at all.
    const payloads = submit.mock.calls.map((call) => call[0]);
    expect(payloads).not.toContainEqual(
      expect.objectContaining({ scanId: "scan-2" })
    );
  });
});
