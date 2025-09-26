import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeScanner, handleScannerInputValue } from "~/components/scanner/code-scanner";
import { handleDetection } from "~/components/scanner/utils";

vi.mock("react-webcam", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("~/components/scanner/success-animation", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("~/components/scanner/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    handleDetection: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleScannerInputValue", () => {
  it("triggers a SAM ID detection when the value matches the pattern", async () => {
    const onSuccess = vi.fn();

    const processed = await handleScannerInputValue({
      rawValue: "sam-0012",
      paused: false,
      onCodeDetectionSuccess: onSuccess,
      allowNonShelfCodes: false,
    });

    expect(processed).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith({
      value: "SAM-0012",
      type: "samId",
    });
    expect(handleDetection).not.toHaveBeenCalled();
  });

  it("returns false and skips detection when the scanner is paused", async () => {
    const onSuccess = vi.fn();

    const processed = await handleScannerInputValue({
      rawValue: "sam-0012",
      paused: true,
      onCodeDetectionSuccess: onSuccess,
      allowNonShelfCodes: false,
    });

    expect(processed).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(handleDetection).not.toHaveBeenCalled();
  });

  it("delegates to handleDetection for non SAM inputs", async () => {
    const onSuccess = vi.fn();

    const processed = await handleScannerInputValue({
      rawValue: "QR123",
      paused: false,
      onCodeDetectionSuccess: onSuccess,
      allowNonShelfCodes: false,
    });

    expect(processed).toBe(true);
    expect(handleDetection).toHaveBeenCalledWith({
      result: "QR123",
      onCodeDetectionSuccess: onSuccess,
      allowNonShelfCodes: false,
      paused: false,
    });
  });
});

describe("CodeScanner", () => {
  it("shows a custom error title when provided", () => {
    render(
      <CodeScanner
        onCodeDetectionSuccess={() => {}}
        paused
        setPaused={() => {}}
        scanMessage=""
        errorMessage="Unable to find SAM ID"
        errorTitle="SAM ID not found"
        forceMode="scanner"
        allowNonShelfCodes
      />
    );

    expect(screen.getByText("SAM ID not found")).toBeInTheDocument();
    expect(screen.getByText("Unable to find SAM ID")).toBeInTheDocument();
  });
});
