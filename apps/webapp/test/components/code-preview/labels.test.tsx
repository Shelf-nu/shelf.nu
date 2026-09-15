import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("lottie-react", () => ({
  default: () => null,
}));

import { BarcodeLabel } from "~/components/code-preview/code-preview";

// The QR label now renders via <QrLabelCard> (a single vector <img> of
// buildLabelSvg); its content/branding is covered by label.test.ts.

describe("BarcodeLabel", () => {
  const baseProps = {
    title: "Camera",
    data: {
      type: "EAN13",
      value: "1234567890123",
    },
  } as const;

  it("shows Shelf branding by default", () => {
    render(<BarcodeLabel {...(baseProps as any)} />);

    expect(screen.getByText(/Powered by/i)).toBeInTheDocument();
  });

  it("hides Shelf branding when requested", () => {
    render(
      <BarcodeLabel
        {...({
          ...baseProps,
          showShelfBranding: false,
        } as any)}
      />
    );

    expect(screen.queryByText(/Powered by/i)).not.toBeInTheDocument();
  });
});
