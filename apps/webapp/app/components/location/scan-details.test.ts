/**
 * Tests for `describeScanSource`: the "Source" row of the Last scan card,
 * which says how the scan was made and, for a barcode or SAM ID, which label.
 *
 * @see {@link file://./scan-details.tsx}
 */
import { describe, expect, it } from "vitest";

import { describeScanSource } from "./scan-details";

describe("describeScanSource", () => {
  it("names a manual GPS update, whatever code it was recorded against", () => {
    expect(
      describeScanSource({
        manuallyGenerated: true,
        codeType: "QR",
        code: null,
      })
    ).toBe("Manually updated");
  });

  it("names the barcode that was scanned", () => {
    expect(
      describeScanSource({
        manuallyGenerated: false,
        codeType: "BARCODE",
        code: "BC-0042",
      })
    ).toBe("Barcode scan: BC-0042");
  });

  it("names the SAM ID that was scanned", () => {
    expect(
      describeScanSource({
        manuallyGenerated: false,
        codeType: "SAM_ID",
        code: "SAM-0007",
      })
    ).toBe("SAM ID scan: SAM-0007");
  });

  it("falls back to the code type when the value is missing", () => {
    expect(
      describeScanSource({
        manuallyGenerated: false,
        codeType: "BARCODE",
        code: null,
      })
    ).toBe("Barcode scan");
    expect(
      describeScanSource({
        manuallyGenerated: false,
        codeType: "SAM_ID",
        code: null,
      })
    ).toBe("SAM ID scan");
  });

  it("calls a QR scan a QR code scan, never showing its id", () => {
    expect(
      describeScanSource({
        manuallyGenerated: false,
        codeType: "QR",
        code: null,
      })
    ).toBe("QR code scan");
  });
});
