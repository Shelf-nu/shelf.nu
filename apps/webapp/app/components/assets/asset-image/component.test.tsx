import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssetImage } from "./component";
import type { AssetForThumbnail } from "./types";

// why: the dialog/button/spinner children pull in Radix + router context that is
// irrelevant to the image-fetch behavior under test; stub them to keep the unit
// focused on how AssetImage handles the thumbnail network request.
vi.mock("~/components/layout/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogPortal: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/shared/button", () => ({
  Button: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("~/components/shared/spinner", () => ({
  Spinner: () => <div data-testid="spinner" />,
}));

/**
 * An asset that has a main image but no thumbnail yet — this is the post-import
 * state that triggers lazy thumbnail generation on mount.
 */
const assetNeedingThumbnail = {
  id: "asset-1",
  thumbnailImage: null,
  // `mainImage` is not part of AssetForThumbnail but the component reads it via
  // an `"mainImage" in asset` guard, so we attach it for the generation path.
  mainImage: "https://x/storage/v1/object/sign/assets/foo.jpg?token=t",
} as unknown as AssetForThumbnail;

describe("AssetImage thumbnail resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // why: jitter delay is `Math.random() * 3000`; pin it to 0 for deterministic
    // timer advancement.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requests thumbnail generation via native fetch on mount", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ asset: { thumbnailImage: null } }), {
        status: 200,
      })
    );

    render(<AssetImage asset={assetNeedingThumbnail} alt="My asset" />);

    // Advance past the on-mount jitter delay.
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/api/asset/generate-thumbnail");
    expect(calledUrl).toContain("assetId=asset-1");
    // It must NOT use the single-fetch `.data` suffix (which is what the route
    // rate-limiter throttles and what crashes the UI on 429).
    expect(calledUrl).not.toContain(".data");
  });

  it("does not crash when thumbnail generation is rate-limited (429)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "Too many requests. Please try again later." },
        }),
        { status: 429 }
      )
    );

    render(<AssetImage asset={assetNeedingThumbnail} alt="My asset" />);
    await act(() => vi.advanceTimersByTimeAsync(3000));

    // The image still renders — the 429 is swallowed, never reaching an error
    // boundary, so the surrounding index UI keeps working.
    expect(screen.getByAltText("My asset")).toBeInTheDocument();
  });

  it("does not crash when the thumbnail request rejects (network error)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));

    render(<AssetImage asset={assetNeedingThumbnail} alt="My asset" />);
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(screen.getByAltText("My asset")).toBeInTheDocument();
  });

  it("only attempts the thumbnail fetch once (no request loop)", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "Too many requests. Please try again later." },
        }),
        { status: 429 }
      )
    );

    render(<AssetImage asset={assetNeedingThumbnail} alt="My asset" />);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Give any erroneous retry loop a chance to fire.
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
