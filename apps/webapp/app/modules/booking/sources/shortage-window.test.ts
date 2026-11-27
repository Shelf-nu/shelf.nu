/**
 * The shortage window: what is left of a booking's window at `now`.
 *
 * @see {@link file://./shortage-window.ts}
 */
import { describe, expect, it } from "vitest";

import { shortageWindow } from "./shortage-window";

const at = (iso: string) => new Date(iso);

describe("shortageWindow", () => {
  it("measures a booking that has not started over its whole window", () => {
    const result = shortageWindow(
      { from: at("2026-12-10T09:00:00Z"), to: at("2026-12-12T09:00:00Z") },
      at("2026-12-01T09:00:00Z")
    );
    expect(result).toEqual({
      window: {
        from: at("2026-12-10T09:00:00Z"),
        to: at("2026-12-12T09:00:00Z"),
      },
      over: false,
    });
  });

  it("measures a started booking from now to its end", () => {
    const result = shortageWindow(
      { from: at("2026-12-10T09:00:00Z"), to: at("2026-12-12T09:00:00Z") },
      at("2026-12-11T09:00:00Z")
    );
    expect(result).toEqual({
      window: {
        from: at("2026-12-11T09:00:00Z"),
        to: at("2026-12-12T09:00:00Z"),
      },
      over: false,
    });
  });

  it("leaves nothing once now reaches the end", () => {
    const now = at("2026-12-12T09:00:00Z");
    const result = shortageWindow(
      { from: at("2026-12-10T09:00:00Z"), to: now },
      now
    );
    expect(result).toEqual({ window: { from: now, to: now }, over: true });
  });
});
