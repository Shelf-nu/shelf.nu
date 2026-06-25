/**
 * PreferredBarcodeSelector behaviour tests.
 *
 * Focused on the live-state contract that PR #2567 round-12 introduced:
 * - Each persisted barcode appears as a radio option alongside the workspace
 *   default.
 * - When the parent re-renders with a `defaultValue` pointing at a barcode
 *   that no longer exists in the `barcodes` prop (because the user removed
 *   it from BarcodesInput), the selector must visually fall back to the
 *   workspace-default option rather than stay stuck on a phantom selection.
 * - The user can still click another override row and have the highlight
 *   reflect their selection.
 * - The empty-state copy renders when no barcodes are passed.
 *
 * @see {@link file://./preferred-barcode-selector.tsx}
 */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { TooltipProvider } from "~/components/shared/tooltip";
import { PreferredBarcodeSelector } from "./preferred-barcode-selector";

/**
 * `PreferredBarcodeSelector` renders `<AssetCodeBadge>` in its override-row
 * previews, which depends on the app-level TooltipProvider at runtime
 * (`root.tsx`). Wrap each test render so the Radix context is present.
 */
function renderWithTooltip(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("PreferredBarcodeSelector", () => {
  const barcodes = [
    { id: "bc-a", type: "Code128" as const, value: "ALPHA" },
    { id: "bc-b", type: "Code128" as const, value: "BETA" },
  ];

  it("lists each persisted barcode as a radio option in addition to workspace default", () => {
    renderWithTooltip(
      <PreferredBarcodeSelector
        name="preferredBarcodeId"
        barcodes={barcodes}
        defaultValue={null}
        workspacePreference="Code128"
      />
    );

    // why: getByRole(radio, { name }) matches each input by its accessible
    // name (the wrapping label's aria-label). Using getByLabelText with
    // /ALPHA/i would also match the AssetCodeBadge chip's aria-label that
    // contains the barcode value, causing "multiple elements" errors.
    expect(
      screen.getByRole("radio", { name: /^Workspace default/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^ALPHA/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^BETA/i })).toBeInTheDocument();
  });

  it("falls back to workspace default when defaultValue points at a barcode no longer in the list", () => {
    // why: this is exactly the live-state bug — user removed the preferred
    // barcode in BarcodesInput; the selector must not stay selected on
    // a barcode that no longer exists in the live list.
    renderWithTooltip(
      <PreferredBarcodeSelector
        name="preferredBarcodeId"
        barcodes={[{ id: "bc-a", type: "Code128", value: "ALPHA" }]}
        defaultValue="bc-removed"
        workspacePreference="Code128"
      />
    );

    const workspaceRadio = screen.getByRole("radio", {
      name: /^Workspace default/i,
    }) as HTMLInputElement;
    expect(workspaceRadio.checked).toBe(true);
  });

  it("clicking an override row updates the highlighted state", async () => {
    const user = userEvent.setup();
    renderWithTooltip(
      <PreferredBarcodeSelector
        name="preferredBarcodeId"
        barcodes={barcodes}
        defaultValue={null}
        workspacePreference="Code128"
      />
    );

    const alphaRadio = screen.getByRole("radio", {
      name: /^ALPHA/i,
    }) as HTMLInputElement;
    expect(alphaRadio.checked).toBe(false);

    await user.click(alphaRadio);
    expect(alphaRadio.checked).toBe(true);
  });

  it("renders the empty-state copy when no barcodes are passed", () => {
    renderWithTooltip(
      <PreferredBarcodeSelector
        name="preferredBarcodeId"
        barcodes={[]}
        defaultValue={null}
        workspacePreference="Code128"
      />
    );

    expect(
      screen.getByText(/This asset has no barcodes yet/i)
    ).toBeInTheDocument();
  });
});
