import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { MarkdownViewer } from "./markdown-viewer";

// why: internal links render through `Button`, which is a react-router `Link`.
const renderNote = (content: string, allowExternalLinks = false) =>
  render(
    <MemoryRouter>
      <MarkdownViewer
        content={content}
        allowExternalLinks={allowExternalLinks}
      />
    </MemoryRouter>
  );

describe("MarkdownViewer", () => {
  describe("system note content (no external links)", () => {
    // These strings are shaped like real system notes: our own wrapper output
    // with a user-controlled entity name spliced into it. The name is the
    // attacker's input.
    it("renders an ordinary Markdown link as plain text", () => {
      // The vector the custom-tag guard misses entirely: `[text](url)` needs no
      // Markdoc delimiters, so write-time stripping never sees it.
      const { container, getByText } = renderNote(
        "changed booking name from **old** to **[Verify your account](https://evil.example/phish)**."
      );

      expect(getByText("Verify your account")).toBeVisible();
      expect(container.querySelector("a")).toBeNull();
      expect(container.innerHTML).not.toContain("evil.example");
    });

    it("drops an off-origin image but keeps its alt text", () => {
      // An injected image fires an off-origin request the moment the feed
      // loads — a tracking pixel aimed at whoever views the note.
      const { container } = renderNote(
        "updated the asset ![px](https://evil.example/track.png) today."
      );

      expect(container.querySelector("img")).toBeNull();
      expect(container.innerHTML).not.toContain("evil.example");
      expect(container.textContent).toContain("px");
    });

    it("still renders internal links", () => {
      const { container } = renderNote("moved to [Shelf A](/locations/loc-1).");

      expect(container.querySelector("a")).toHaveAttribute(
        "href",
        "/locations/loc-1"
      );
    });

    it("neutralizes the custom link tag with an off-origin target", () => {
      const { container, getByText } = renderNote(
        '{% link to="https://evil.example" text="Verify" /%}'
      );

      expect(getByText("Verify")).toBeVisible();
      expect(container.querySelector("a")).toBeNull();
    });
  });

  describe("user-authored comments (external links allowed)", () => {
    it("keeps an external link but adds the tabnabbing guard", () => {
      const { container } = renderNote(
        "see [the manual](https://supplier.example/manual.pdf)",
        true
      );

      const link = container.querySelector("a");
      expect(link).toHaveAttribute(
        "href",
        "https://supplier.example/manual.pdf"
      );
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it.each([
      ["javascript", "javascript:alert(1)"],
      ["data", "data:text/html,<script>alert(1)</script>"],
      ["vbscript", "vbscript:msgbox(1)"],
    ])("still blocks the %s scheme", (_label, payload) => {
      // Allowing authors to link out must never extend to script-bearing
      // schemes, comment or not.
      const { container } = renderNote(`click [here](${payload})`, true);

      expect(container.querySelector("a")).toBeNull();
    });

    it("still drops off-origin images", () => {
      const { container } = renderNote(
        "![px](https://evil.example/track.png)",
        true
      );

      expect(container.querySelector("img")).toBeNull();
    });
  });
});
