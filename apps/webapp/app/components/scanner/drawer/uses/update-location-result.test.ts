/**
 * The bulk "Update location" save sends assets and kits in two requests. Its
 * result decides whether the list and its scan draft are kept, so a failure in
 * either part must fail the whole save.
 *
 * @see {@link file://./update-location-result.ts}
 */
import { describe, expect, it, vi } from "vitest";
import { foldLocationPart, sendLocationParts } from "./update-location-result";

const processing = { status: "processing" } as const;

describe("foldLocationPart", () => {
  it("succeeds when every part succeeds", () => {
    const afterAssets = foldLocationPart(processing, {});
    expect(foldLocationPart(afterAssets, {})).toEqual({ status: "success" });
  });

  it("keeps an assets failure when the kits then move", () => {
    const afterAssets = foldLocationPart(processing, {
      error: { message: "Assets could not be moved" },
    });

    expect(foldLocationPart(afterAssets, {})).toEqual({
      status: "error",
      errorMessage: "Assets could not be moved",
    });
  });

  it("fails when the kits fail after the assets moved", () => {
    const afterAssets = foldLocationPart(processing, {});

    expect(
      foldLocationPart(afterAssets, {
        error: { message: "Kits could not be moved" },
      })
    ).toEqual({ status: "error", errorMessage: "Kits could not be moved" });
  });
});

describe("sendLocationParts", () => {
  const saved = () => Promise.resolve({});

  it("sends the assets, then the kits, and folds both answers", async () => {
    const sendKits = vi.fn(saved);
    const progress = vi.fn();

    const result = await sendLocationParts({
      sendAssets: saved,
      sendKits,
      isCurrent: () => true,
      onProgress: progress,
    });

    expect(sendKits).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      result: { status: "success" },
      parts: { assets: "success", kits: "success" },
    });
    // Before sending, and once the assets answered.
    expect(progress).toHaveBeenLastCalledWith({
      result: { status: "processing" },
      parts: { assets: "success", kits: "processing" },
    });
  });

  /**
   * Done pressed while the assets are waiting keeps the list, which can then
   * be saved to another location. The first save's kit request must not be
   * sent after that, or it would move the kits back.
   */
  it("does not send the kits once the save is no longer current", async () => {
    let current = true;
    let answerAssets: (answer: object) => void = () => {};
    const sendKits = vi.fn(saved);

    const sending = sendLocationParts({
      sendAssets: () =>
        new Promise((resolve) => {
          answerAssets = resolve;
        }),
      sendKits,
      isCurrent: () => current,
      onProgress: () => {},
    });
    current = false;
    answerAssets({});

    await expect(sending).resolves.toBeNull();
    expect(sendKits).not.toHaveBeenCalled();
  });

  it("reports a saved assets part before a kit request that throws", async () => {
    const progress = vi.fn();

    await expect(
      sendLocationParts({
        sendAssets: saved,
        sendKits: () => Promise.reject(new TypeError("Failed to fetch")),
        isCurrent: () => true,
        onProgress: progress,
      })
    ).rejects.toThrow("Failed to fetch");
    expect(progress).toHaveBeenLastCalledWith({
      result: { status: "processing" },
      parts: { assets: "success", kits: "processing" },
    });
  });

  it("skips a part with nothing to send", async () => {
    await expect(
      sendLocationParts({
        sendAssets: null,
        sendKits: saved,
        isCurrent: () => true,
        onProgress: () => {},
      })
    ).resolves.toEqual({
      result: { status: "success" },
      parts: { assets: "skipped", kits: "success" },
    });
  });
});
