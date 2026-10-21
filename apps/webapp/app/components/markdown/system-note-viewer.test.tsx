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
});
