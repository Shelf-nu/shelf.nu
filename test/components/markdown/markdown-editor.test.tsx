import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownEditor } from "~/components/markdown/markdown-editor";

describe("MarkdownEditor", () => {
  it("always renders EditorV2", () => {
    render(
      <MarkdownEditor
        label="Body"
        name="body"
        placeholder="Start writing"
        defaultValue=""
      />
    );

    expect(screen.getByTestId("editor-v2-content")).toBeInTheDocument();
  });
});
