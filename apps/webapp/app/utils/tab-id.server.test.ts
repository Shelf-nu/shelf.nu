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

  it("does not leak tabId across concurrent contexts", async () => {
    const results: Array<string | undefined> = [];

    await Promise.all([
      new Promise<void>((r) =>
        runWithTabId("tab-A", () => {
          results.push(getTabId());
          r();
        })
      ),
      new Promise<void>((r) =>
        runWithTabId("tab-B", () => {
          results.push(getTabId());
          r();
        })
      ),
    ]);

    expect(results).toContain("tab-A");
    expect(results).toContain("tab-B");
    expect(results).toHaveLength(2);
  });
});
