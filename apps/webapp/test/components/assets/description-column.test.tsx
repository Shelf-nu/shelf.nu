import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// why: lottie-web draws on a canvas at import time, which happy-dom lacks
vi.mock("lottie-react", () => ({
  default: () => null,
}));

import { DescriptionColumn } from "~/components/assets/assets-index/advanced-asset-columns";

function renderInRow(value: string) {
  render(
    <table>
      <tbody>
        <tr>
          <DescriptionColumn value={value} />
        </tr>
      </tbody>
    </table>
  );
}

describe("DescriptionColumn", () => {
  it("caps a long description in the tooltip and points to the asset", async () => {
    const description = `${"a".repeat(600)}TAILWORD`;
    renderInRow(description);

    await userEvent.setup().hover(screen.getByRole("button"));

    const hints = await screen.findAllByText(
      "Open the asset to read the full description"
    );
    expect(hints.length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain(`${"a".repeat(600)}…`);
    expect(document.body.textContent).not.toContain("TAILWORD");
  });

  it("shows a description of 600 characters in full, without the hint", async () => {
    const description = `${"a".repeat(592)}TAILWORD`;
    renderInRow(description);

    await userEvent.setup().hover(screen.getByRole("button"));

    expect(
      (await screen.findAllByText("Asset description")).length
    ).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("TAILWORD");
    expect(
      screen.queryByText("Open the asset to read the full description")
    ).toBeNull();
  });
});
