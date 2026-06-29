import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssetImage } from "./component";
import type { AssetForPreview, AssetForThumbnail } from "./types";

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
 * Builds an asset that has a main image but no thumbnail yet — the post-import
 * state that triggers lazy thumbnail generation on mount.
 *
 * `mainImage` is not part of `AssetForThumbnail`, but the component reads it via
 * an `"mainImage" in asset` guard, so we attach it (and cast) for the
 * generation path.
 */
const createAssetNeedingThumbnail = (
  overrides: Partial<AssetForThumbnail & { mainImage: string }> = {}
) =>
  ({
    id: "asset-1",
    thumbnailImage: null,
    mainImage: "https://x/storage/v1/object/sign/assets/foo.jpg?token=t",
    ...overrides,
  }) as unknown as AssetForThumbnail;

/**
 * Builds a preview asset whose signed URLs have already expired — this triggers
 * the on-mount `refresh-main-image` request. A non-null `thumbnailImage` keeps
 * the thumbnail-generation path from also firing, isolating the refresh path.
 */
const createExpiredPreviewAsset = (): AssetForPreview =>
  ({
    id: "asset-2",
    thumbnailImage: "https://x/storage/v1/object/sign/assets/foo-thumbnail.jpg",
    mainImage: "https://x/storage/v1/object/sign/assets/foo.jpg?token=t",
    mainImageExpiration: new Date("2000-01-01T00:00:00.000Z"),
  }) as unknown as AssetForPreview;

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
    // why: fetch is the external network boundary; stub it to assert the request
    // shape without hitting the server.
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ asset: { thumbnailImage: null } }), {
        status: 200,
      })
    );

    render(<AssetImage asset={createAssetNeedingThumbnail()} alt="My asset" />);

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
    // why: fetch is the external network boundary; stub a 429 to simulate the
    // loader rate-limiter rejecting the request.
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "Too many requests. Please try again later." },
        }),
        { status: 429 }
      )
    );

    render(<AssetImage asset={createAssetNeedingThumbnail()} alt="My asset" />);
    await act(() => vi.advanceTimersByTimeAsync(3000));

    // The image still renders — the 429 is swallowed, never reaching an error
    // boundary, so the surrounding index UI keeps working.
    expect(screen.getByAltText("My asset")).toBeInTheDocument();
  });

  it("does not crash when the thumbnail request rejects (network error)", async () => {
    // why: fetch is the external network boundary; stub a rejection to simulate
    // a dropped/aborted request.
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));

    render(<AssetImage asset={createAssetNeedingThumbnail()} alt="My asset" />);
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(screen.getByAltText("My asset")).toBeInTheDocument();
  });

  it("only attempts the thumbnail fetch once (no request loop)", async () => {
    // why: fetch is the external network boundary; stub a 429 to verify a failed
    // request does not spawn a retry storm.
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "Too many requests. Please try again later." },
        }),
        { status: 429 }
      )
    );

    render(<AssetImage asset={createAssetNeedingThumbnail()} alt="My asset" />);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Give any erroneous retry loop a chance to fire.
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not crash when refresh-main-image is rate-limited (429)", async () => {
    // why: fetch is the external network boundary; stub a 429 on the refresh
    // path (the other endpoint this PR moved to native fetch).
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "Too many requests. Please try again later." },
        }),
        { status: 429 }
      )
    );

    render(
      <AssetImage
        asset={createExpiredPreviewAsset()}
        alt="My asset"
        withPreview
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));

    // The expired preview asset triggers refresh-main-image, not the thumbnail
    // endpoint — and the 429 must be swallowed without crashing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/asset/refresh-main-image"
    );
    expect(screen.getAllByAltText("My asset").length).toBeGreaterThan(0);
  });

  it("re-runs generation for a new asset when the instance is reused", async () => {
    // why: fetch is the external network boundary; stub success so each mount/
    // asset-swap issues exactly one generation request.
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ asset: { thumbnailImage: null } }), {
        status: 200,
      })
    );

    const { rerender } = render(
      <AssetImage
        asset={createAssetNeedingThumbnail({ id: "asset-1" })}
        alt="First"
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("assetId=asset-1");

    // Reuse the same component instance for a different asset (no key remount).
    rerender(
      <AssetImage
        asset={createAssetNeedingThumbnail({ id: "asset-9" })}
        alt="Second"
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));

    // The new asset must get its own generation request, not the prior result.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("assetId=asset-9");
  });

  it("ignores a stale in-flight response after the asset changes", async () => {
    // why: fetch is the external network boundary; here we hold each request
    // open (deferred) so we can resolve the stale one last and prove it's
    // dropped rather than applied to the new asset.
    const calls: Array<{
      url: string;
      signal?: AbortSignal | null;
      resolve: (r: Response) => void;
    }> = [];
    vi.spyOn(global, "fetch").mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          calls.push({ url: String(input), signal: init?.signal, resolve });
        })
    );

    const { rerender } = render(
      <AssetImage
        asset={createAssetNeedingThumbnail({ id: "asset-1" })}
        alt="Pic"
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("assetId=asset-1");

    // Swap to a new asset while the first request is still in flight.
    rerender(
      <AssetImage
        asset={createAssetNeedingThumbnail({ id: "asset-9" })}
        alt="Pic"
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("assetId=asset-9");
    // The asset swap must have aborted the first request's signal.
    expect(calls[0].signal?.aborted).toBe(true);

    // Resolve the NEW asset's request, then the STALE one, flushing the fetch
    // handler's microtasks (fetch + json + dispatch) after each.
    const flushPromises = async () => {
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
    };
    const thumbResponse = (file: string) =>
      new Response(JSON.stringify({ asset: { thumbnailImage: file } }), {
        status: 200,
      });

    await act(async () => {
      calls[1].resolve(thumbResponse("thumb-9.jpg"));
      await flushPromises();
    });
    await act(async () => {
      calls[0].resolve(thumbResponse("thumb-1.jpg"));
      await flushPromises();
    });

    // The rendered thumbnail must be asset-9's, never the stale asset-1 result.
    const img = screen.getByAltText("Pic") as HTMLImageElement;
    expect(img.src).toContain("thumb-9.jpg");
    expect(img.src).not.toContain("thumb-1.jpg");
  });
});
