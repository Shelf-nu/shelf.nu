/**
 * AssetCodeBadge — unit tests
 *
 * Verifies the rendering contract of the asset display-code chip:
 *  - The chip renders the value text on every list-view surface.
 *  - The chip exposes its explanatory tooltip text via `aria-label` so screen
 *    readers receive the explanation without needing to hover/focus.
 *  - The tooltip wording adapts to fallback / override / explicit-column modes.
 *  - Empty values produce no DOM (defensive against loaders that omit
 *    `qrCodes`/`barcodes` from their `select`).
 *
 * @see {@link file://./asset-code-badge.tsx}
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AssetCodeBadge } from "./asset-code-badge";

describe("AssetCodeBadge", () => {
  it("renders the value text", () => {
    render(
      <AssetCodeBadge
        value="ABC-123"
        type="Code128"
        isFallback={false}
        workspacePreference="Code128"
      />
    );

    expect(screen.getByText("ABC-123")).toBeInTheDocument();
  });

  it("exposes the explanatory tooltip text via aria-label on the badge", () => {
    // why: Radix tooltip content is in a Portal and only mounts on hover —
    // testing the content via `findByRole('tooltip')` is timing-dependent.
    // The badge itself carries the same string as aria-label so screen
    // readers can read it without hover; we assert against that.
    render(
      <AssetCodeBadge
        value="ABC-123"
        type="Code128"
        isFallback={false}
        workspacePreference="Code128"
      />
    );

    const badge = screen.getByLabelText(
      /matches your workspace's preferred display code/i
    );
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain("ABC-123");
  });

  it("explains fallback state in the tooltip", () => {
    render(
      <AssetCodeBadge
        value="qr-abc"
        type="QR_ID"
        isFallback={true}
        workspacePreference="Code128"
      />
    );

    expect(
      screen.getByLabelText(
        /your workspace prefers Code 128 but this item has no Code 128/i
      )
    ).toBeInTheDocument();
  });

  it("collapses tooltip to type:value form when explicit=true", () => {
    render(
      <AssetCodeBadge
        value="SAM-0001"
        type="SAM_ID"
        isFallback={false}
        workspacePreference="Code128"
        explicit
      />
    );

    const badge = screen.getByLabelText("SAM ID: SAM-0001");
    expect(badge).toBeInTheDocument();
  });

  it("does not render when value is empty", () => {
    const { container } = render(
      <AssetCodeBadge
        value=""
        type="QR_ID"
        isFallback={false}
        workspacePreference="QR_ID"
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
