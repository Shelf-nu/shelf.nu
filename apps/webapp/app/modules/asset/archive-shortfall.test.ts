/**
 * The archive model-reservation warning (issue #382) is built on the server and
 * recognised in the UI from the same module, so the two must agree.
 *
 * @see {@link file://./archive-shortfall.ts}
 */
import { describe, expect, it } from "vitest";
import {
  formatModelShortfallMessage,
  isModelShortfallMessage,
} from "./archive-shortfall";

describe("archive model-reservation shortfall", () => {
  it("names every booking, model and the units it would lack", () => {
    const message = formatModelShortfallMessage([
      { bookingId: "b1", bookingName: "Shoot", modelName: "Sony A7", short: 1 },
      { bookingId: "b2", bookingName: "Expo", modelName: "Tripod", short: 2 },
    ]);

    expect(message).toContain('"Shoot" (1 Sony A7 unit short)');
    expect(message).toContain('"Expo" (2 Tripod units short)');
  });

  it("recognises its own warning and nothing else", () => {
    const message = formatModelShortfallMessage([
      { bookingId: "b1", bookingName: "Shoot", modelName: "Sony A7", short: 1 },
    ]);

    expect(isModelShortfallMessage(message)).toBe(true);
    expect(isModelShortfallMessage("Asset is archived")).toBe(false);
    expect(isModelShortfallMessage(null)).toBe(false);
    expect(isModelShortfallMessage(undefined)).toBe(false);
  });
});
