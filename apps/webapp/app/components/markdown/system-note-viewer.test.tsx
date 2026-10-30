import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { MarkdownViewer } from "./markdown-viewer";
import { SystemNoteViewer } from "./system-note-viewer";

/** A description change whose new text spans two lines, stored raw. */
const MULTI_LINE_DESCRIPTION_NOTE =
  '{% link to="/settings/team/users/u1" text="Jane Doe" /%} updated the asset description {% description oldText="aa" newText="first line\r\nsecond line" /%}.';

// why: internal links render through `Button`, which is a react-router `Link`.
const renderSystemNote = (content: string) =>
  render(
    <MemoryRouter>
      <SystemNoteViewer content={content} />
    </MemoryRouter>
  );

describe("SystemNoteViewer", () => {
  it("shows both texts of a multi-line description change", () => {
    const { container } = renderSystemNote(MULTI_LINE_DESCRIPTION_NOTE);

    expect(container.textContent).toContain(
      "updated the asset description aa to"
    );
    // The multi-line text renders as a popover trigger showing its preview.
    const trigger = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.trim().endsWith("first line second line...")
    );
    expect(trigger).toBeDefined();
  });

  it("shows a user link whose name has a backslash", () => {
    const { container } = renderSystemNote(
      '{% link to="/settings/team/users/u2" text="Customer\\Barbara" /%} checked out the asset.'
    );

    expect(container.querySelector("a")).toHaveTextContent("Customer\\Barbara");
  });

  it("keeps off-origin links blocked", () => {
    const { container, getByText } = renderSystemNote(
      '{% link to="https://evil.example" text="Verify" /%}'
    );

    expect(getByText("Verify")).toBeVisible();
    expect(container.querySelector("a")).toBeNull();
  });

  it("is required: a bare MarkdownViewer drops the raw multi-line tag", () => {
    // MarkdownViewer renders author-written content exactly as typed, so it
    // never encodes raw attribute values. A system note shown through it
    // loses the whole description tag.
    const { container } = render(
      <MemoryRouter>
        <MarkdownViewer content={MULTI_LINE_DESCRIPTION_NOTE} />
      </MemoryRouter>
    );

    expect(container.textContent).toContain("updated the asset description .");
    expect(container.textContent).not.toContain("first line");
  });

  describe("web links", () => {
    const offSite = (container: HTMLElement) =>
      Array.from(container.querySelectorAll("a")).filter((a) =>
        (a.getAttribute("href") ?? "").startsWith("https://evil.example")
      );

    it("never links a name that looks like a URL", () => {
      const { container, getByText } = renderSystemNote(
        '{% link to="/settings/team/users/u1" text="Sam Lee" /%} changed booking name from {% name text="Shoot" /%} to {% name text="https://evil.example/login" /%}.'
      );

      expect(getByText("https://evil.example/login")).toBeVisible();
      expect(offSite(container)).toHaveLength(0);
    });

    it("never links a bare URL in an older note's text", () => {
      const { container } = renderSystemNote(
        "Sam changed booking name from **Shoot** to **https://evil.example/login**."
      );

      expect(container.textContent).toContain("https://evil.example/login");
      expect(offSite(container)).toHaveLength(0);
    });

    it("does not bring back a Markdown link the sanitizer unwrapped", () => {
      const { container } = renderSystemNote(
        "renamed to **[https://evil.example/login](https://evil.example/login)**."
      );

      expect(offSite(container)).toHaveLength(0);
    });

    it("shows a custom field value its writer marked as a chip", () => {
      const { container } = renderSystemNote(
        '{% link to="/settings/team/users/u1" text="Sam Lee" /%} set {% name text="Manual" /%} to {% name text="https://docs.example.com/manual.pdf" chips=true /%}.'
      );

      const chip = container.querySelector(
        'a[href^="https://docs.example.com/manual.pdf"]'
      );
      expect(chip).not.toBeNull();
      expect(chip).toHaveAttribute("target", "_blank");
    });
  });
});
