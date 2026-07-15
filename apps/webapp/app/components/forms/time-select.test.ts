/**
 * TimeSelect display-label formatting — unit tests
 *
 * Verifies `getDisplayLabel` renders a stored 24h value in the caller's
 * chosen time format: 12h AM/PM (default) or raw 24h HH:mm.
 *
 * @see {@link file://./time-select.tsx}
 */
import { describe, it, expect } from "vitest";
import { getDisplayLabel } from "./time-select";

describe("getDisplayLabel", () => {
  it("renders 12-hour AM/PM by default", () => {
    expect(getDisplayLabel("09:00")).toBe("9:00 AM");
    expect(getDisplayLabel("13:15")).toBe("1:15 PM");
    expect(getDisplayLabel("00:00")).toBe("12:00 AM");
  });

  it("renders the 23:59 end-of-day sentinel", () => {
    expect(getDisplayLabel("23:59", "H12")).toBe("11:59 PM");
    expect(getDisplayLabel("23:59", "H24")).toBe("23:59");
  });

  it("renders raw 24-hour HH:mm when timeFormat is H24", () => {
    expect(getDisplayLabel("09:00", "H24")).toBe("09:00");
    expect(getDisplayLabel("13:15", "H24")).toBe("13:15");
    expect(getDisplayLabel("00:00", "H24")).toBe("00:00");
  });
});
