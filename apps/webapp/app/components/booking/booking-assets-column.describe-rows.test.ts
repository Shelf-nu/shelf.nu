/**
 * The Assets & Kits header must describe the rows under it in words that say
 * what they are.
 *
 * A kit is ONE row holding SEVERAL assets, so a bare row count can never equal
 * the bookings index's asset count. The header used to say "20 items" next to
 * an index reading "25 assets" for the same booking, leaving the reader to work
 * out that two kit rows held the other seven.
 */
import { describe, expect, it } from "vitest";
import { describeBookingRows } from "./booking-assets-column";

const asset = { type: "asset" };
const kit = { type: "kit" };

describe("describeBookingRows", () => {
  it("names both kinds of row so the index's asset count is reconcilable", () => {
    const rows = [...Array(18).fill(asset), kit, kit];
    // 20 rows, but 25 assets on the index — the two kits hold the other 7, and
    // each kit row states its own member count.
    expect(describeBookingRows(rows)).toBe("18 assets and 2 kits");
  });

  it("says only assets when the booking has no kits", () => {
    // The reported booking's shape. Must match the index verbatim: "7 assets".
    expect(describeBookingRows(Array(7).fill(asset))).toBe("7 assets");
  });

  it("says only kits when every row is a kit", () => {
    // Not "0 assets and 2 kits" — a leading zero reads as a problem.
    expect(describeBookingRows([kit, kit])).toBe("2 kits");
  });

  it("uses singular for exactly one of each", () => {
    expect(describeBookingRows([asset])).toBe("1 asset");
    expect(describeBookingRows([kit])).toBe("1 kit");
    expect(describeBookingRows([asset, kit])).toBe("1 asset and 1 kit");
  });

  it("describes an empty list as zero assets rather than saying nothing", () => {
    expect(describeBookingRows([])).toBe("0 assets");
  });
});
