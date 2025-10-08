import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import { TextSelection } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";

import { EditorV2 } from "~/components/editor-v2/editor-v2";

describe("EditorV2", () => {
  it("retains unsaved content when toggling disabled", async () => {
    const handleChange = vi.fn();

    const { rerender } = render(
      <EditorV2
        defaultValue=""
        label="Content"
        name="content"
        disabled={false}
        onChange={handleChange}
      />
    );

    const container = await screen.findByTestId("editor-v2-content");

    await waitFor(() => {
      expect(
        container.querySelector('[contenteditable="true"]')
      ).not.toBeNull();
    });

    const getEditorView = () =>
      ((container as any)?.__editorView ?? null) as {
        dispatch: (tr: any) => void;
        state: any;
      } | null;

    let view = getEditorView();
    await waitFor(() => {
      view = getEditorView();
      expect(view).toBeTruthy();
    });

    const activeView = view!;

    act(() => {
      activeView.dispatch(activeView.state.tr.insertText("Hello"));
    });

    await waitFor(() => {
      expect(
        (screen.getByTestId("editor-v2-input") as HTMLTextAreaElement).value
      ).toBe("Hello\n");
    });

    expect(handleChange).toHaveBeenCalledWith(expect.stringContaining("Hello"));

    rerender(
      <EditorV2
        defaultValue=""
        label="Content"
        name="content"
        disabled
        onChange={handleChange}
      />
    );

    await waitFor(() => {
      expect(
        (screen.getByTestId("editor-v2-input") as HTMLTextAreaElement).value
      ).toBe("Hello\n");
    });

    rerender(
      <EditorV2
        defaultValue=""
        label="Content"
        name="content"
        disabled={false}
        onChange={handleChange}
      />
    );

    let updatedView = getEditorView();
    await waitFor(() => {
      updatedView = getEditorView();
      expect(updatedView).toBeTruthy();
    });

    const activeUpdatedView = updatedView!;

    act(() => {
      const endSelection = TextSelection.atEnd(activeUpdatedView.state.doc);
      activeUpdatedView.dispatch(
        activeUpdatedView.state.tr.setSelection(endSelection)
      );
      activeUpdatedView.dispatch(
        activeUpdatedView.state.tr.insertText(" World")
      );
    });

    await waitFor(() => {
      expect(
        (screen.getByTestId("editor-v2-input") as HTMLTextAreaElement).value
      ).toBe("Hello World\n");
    });
  });
});
