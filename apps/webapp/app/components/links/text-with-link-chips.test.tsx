/**
 * Tests for `TextWithLinkChips`, the asset description with its web links as
 * link chips.
 *
 * @see {@link file://./text-with-link-chips.tsx}
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextWithLinkChips } from "./text-with-link-chips";

const MANUAL = "https://www.example.com/manual.pdf";

describe("TextWithLinkChips", () => {
  it("shows the link as a chip and keeps the text around it", () => {
    const { container } = render(
      <TextWithLinkChips text={`Manual: ${MANUAL} (rev B)`} />
    );

    const chip = container.querySelector(`a[href^="${MANUAL}"]`);
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("target", "_blank");
    expect(container.textContent).toMatch(/^Manual: .+ \(rev B\)$/);
  });

  it("shows a link's page title on its chip", () => {
    const { container } = render(
      <TextWithLinkChips
        text={`See ${MANUAL}`}
        titles={{ [MANUAL]: { pageTitle: "X200 manual", customTitle: null } }}
      />
    );

    expect(container.querySelector("a")).toHaveTextContent("X200 manual");
  });

  it("shows text without a link as it is", () => {
    const { container } = render(<TextWithLinkChips text="see binder 3" />);

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("see binder 3");
  });
});
