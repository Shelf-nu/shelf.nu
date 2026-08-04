import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { LinkComponent } from "./link-component";

// why: `Button` renders a react-router `Link` for internal targets, which needs
// router context. The rejected cases render a plain span and don't, but wrapping
// uniformly keeps the two paths comparable in the assertions below.
const renderLink = (to: string, text = "label") =>
  render(
    <MemoryRouter>
      <LinkComponent to={to} text={text} />
    </MemoryRouter>
  );

describe("LinkComponent", () => {
  it("renders an anchor for an internal path", () => {
    renderLink("/assets/clx123", "Apple Mac Pro");

    const link = screen.getByText("Apple Mac Pro").closest("a");
    expect(link).toHaveAttribute("href", "/assets/clx123");
  });

  describe("link targets that leave our origin", () => {
    // Note content is assembled from user-controlled values, so an injected
    // Markdoc tag can hand this component any target it likes. The label must
    // still render — dropping it would leave the note unreadable — but never as
    // a clickable destination.
    it.each([
      ["javascript scheme", "javascript:alert(1)"],
      ["data scheme", "data:text/html,<script>alert(1)</script>"],
      ["absolute url", "https://evil.com/phish"],
      ["protocol-relative", "//evil.com"],
      ["backslash host", "/\\evil.com"],
    ])("renders %s as plain text, not a link", (_label, payload) => {
      renderLink(payload, "Verify your account");

      const label = screen.getByText("Verify your account");
      expect(label).toBeVisible();
      expect(label.closest("a")).toBeNull();
    });
  });

  it("emits no href at all for a rejected target", () => {
    // Guards against a regression that keeps the anchor but blanks the href:
    // the destination must be gone from the DOM entirely.
    const { container } = renderLink("https://evil.com", "click me");

    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).not.toContain("evil.com");
  });
});
