/**
 * Unit tests for the tab ID server utilities.
 *
 * Verifies that {@link getTabId} and {@link runWithTabId} correctly scope
 * tab identifiers using `AsyncLocalStorage`, ensuring session/tab isolation
 * across concurrent async operations in the webapp server.
 *
 * @see {@link file://./tab-id.server.ts}
 */
import { describe, expect, it } from "vitest";
import { getTabId, runWithTabId } from "./tab-id.server";

describe("tab-id.server", () => {
  it("returns undefined outside any context", () => {
    expect(getTabId()).toBeUndefined();
  });

  it("returns the tabId inside the callback context", () => {
    runWithTabId("tab-123", () => {
      expect(getTabId()).toBe("tab-123");
    });
  });

  it("returns undefined for an explicitly undefined tabId", () => {
    runWithTabId(undefined, () => {
      expect(getTabId()).toBeUndefined();
    });
  });

  it("does not leak tabId across concurrent async contexts", async () => {
    const results: Array<string | undefined> = [];

    await Promise.all([
      new Promise<void>((resolve) =>
        runWithTabId("tab-A", async () => {
          // Cross an async boundary so the context must survive a microtask hop
          await Promise.resolve();
          results.push(getTabId());
          resolve();
        })
      ),
      new Promise<void>((resolve) =>
        runWithTabId("tab-B", async () => {
          await Promise.resolve();
          results.push(getTabId());
          resolve();
        })
      ),
    ]);

    expect(results).toContain("tab-A");
    expect(results).toContain("tab-B");
    expect(results).toHaveLength(2);
  });
});
