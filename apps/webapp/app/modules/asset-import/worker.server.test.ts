// @vitest-environment node
/**
 * Tests for `enqueueAssetImportStep`: queue name, payload, send options and
 * singleton key per step, and how queue results are handled.
 *
 * @see {@link file://./worker.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";
import { scheduler } from "~/utils/scheduler.server";
import { ASSET_IMPORT_JOB_OPTIONS } from "./constants";
import { enqueueAssetImportStep } from "./worker.server";

// why: no pg-boss instance or database exists in unit tests.
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { assetImportQueue: "asset-import-queue" },
  scheduler: { send: vi.fn() },
}));

// why: the logger writes to the console and Sentry.
vi.mock("~/utils/logger", () => ({
  Logger: { info: vi.fn(), error: vi.fn() },
}));

describe("enqueueAssetImportStep", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(scheduler.send).mockResolvedValue("job-1");
  });

  it.each([
    [{ importId: "imp", step: "PREPARE" as const }, "imp:PREPARE"],
    [{ importId: "imp", step: "ROWS" as const, chunkIndex: 3 }, "imp:ROWS:3"],
    [{ importId: "imp", step: "FINALIZE" as const }, "imp:FINALIZE"],
  ])("sends %j with singleton key %s", async (data, singletonKey) => {
    await enqueueAssetImportStep(data);

    expect(scheduler.send).toHaveBeenCalledWith("asset-import-queue", data, {
      ...ASSET_IMPORT_JOB_OPTIONS,
      singletonKey,
    });
  });

  it("treats a step that is already queued as success", async () => {
    vi.mocked(scheduler.send).mockResolvedValue(null);

    await expect(
      enqueueAssetImportStep({ importId: "imp", step: "PREPARE" })
    ).resolves.toBeUndefined();
  });

  it("wraps a queue failure in a ShelfError", async () => {
    vi.mocked(scheduler.send).mockRejectedValue(new Error("connection lost"));

    const error = await enqueueAssetImportStep({
      importId: "imp",
      step: "FINALIZE",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error).toMatchObject({ label: "Asset Import" });
  });
});
