import type { ComponentProps } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react-dom/test-utils";
import { TextSelection } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";
import type { Mark, Node as PMNode } from "prosemirror-model";

import { EditorV2 } from "~/components/editor-v2/editor-v2";
import { SlashCommandMenu } from "~/components/editor-v2/components/slash-command-menu";
import { createEditorSchema, serializeMarkdoc } from "~/modules/editor-v2/markdoc-utils";

describe("EditorV2", () => {
  async function setupEditor(props: Partial<ComponentProps<typeof EditorV2>> = {}) {
    const handleChange = vi.fn();

    const utils = render(
      <EditorV2
        defaultValue=""
        label="Content"
        name="content"
        onChange={handleChange}
        {...props}
      />
    );

    const container = await screen.findByTestId("editor-v2-content");

    await waitFor(() => {
      expect(
        container.querySelector('[contenteditable="true"]')
      ).not.toBeNull();
    });

    const getView = () =>
      ((container as any).__editorView ?? null) as {
        dispatch: (tr: any) => void;
        state: any;
        dom: HTMLElement;
        focus: () => void;
        hasFocus: () => boolean;
      } | null;

    let view = getView();
    await waitFor(() => {
      view = getView();
      expect(view).toBeTruthy();
    });

    return {
      ...utils,
      container,
      view: view!,
      getView,
      handleChange,
    };
  }

  it("retains unsaved content when toggling disabled", async () => {
    const { view, rerender, handleChange, getView } = await setupEditor({
      disabled: false,
    });

    const activeView = view;

    act(() => {
      activeView.dispatch(activeView.state.tr.insertText("Hello"));
    });

    expect(activeView.state.doc.textContent).toBe("Hello");
    expect(serializeMarkdoc(activeView.state.doc, createEditorSchema())).toBe(
      "Hello\n"
    );

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(
        expect.stringContaining("Hello")
      );
    });

    expect(
      (screen.getByTestId("editor-v2-input") as HTMLTextAreaElement).value
    ).toContain("Hello");

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
      ).toContain("Hello");
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

    let reEnabledView = getView();
    await waitFor(() => {
      reEnabledView = getView();
      expect(reEnabledView).toBeTruthy();
    });

    const activeUpdatedView = reEnabledView!;

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
      ).toContain("Hello World");
    });
  });

  it("opens the link dialog when the caret is inside a link", async () => {
    const user = userEvent.setup();
    const { view } = await setupEditor({
      defaultValue: "[example](https://example.com)",
    });

    let linkFrom = 0;
    view.state.doc.descendants((node: PMNode, pos: number) => {
      if (node.marks?.some((mark: Mark) => mark.type.name === "link")) {
        linkFrom = pos;
        return false;
      }
      return undefined;
    });

    act(() => {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, linkFrom + 1)
        )
      );
    });

    const linkButton = screen.getByRole("button", { name: "Link (⌘⇧K)" });
    await act(async () => {
      await user.click(linkButton);
    });

    const dialog = await screen.findByRole("alertdialog", { name: "Edit link" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("URL")).toHaveValue("https://example.com");
  });

  it("highlights link controls when the selection is on a link", async () => {
    const { view } = await setupEditor({
      defaultValue: "[example](https://example.com)",
    });

    let linkFrom = 0;
    view.state.doc.descendants((node: PMNode, pos: number) => {
      if (node.marks?.some((mark: Mark) => mark.type.name === "link")) {
        linkFrom = pos;
        return false;
      }
      return undefined;
    });

    act(() => {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, linkFrom + 1)
        )
      );
    });

    const linkButton = await screen.findByRole("button", {
      name: "Link (⌘⇧K)",
    });
    await waitFor(() => {
      expect(linkButton).toHaveAttribute("aria-pressed", "true");
      expect(linkButton.className).toContain("bg-accent");
    });
  });

  it("always displays slash command helper text", async () => {
    await setupEditor();

    expect(
      screen.getByText(
        "Content supports Markdown and Markdoc. Use / to access commands."
      )
    ).toBeInTheDocument();
  });

  it("renders toolbar buttons with icons and shortcut tooltips", async () => {
    await setupEditor();

    const toolbar = screen.getByRole("toolbar", {
      name: "Editor formatting toolbar",
    });

    const expectedButtons = [
      "Undo (⌘Z)",
      "Redo (⌘⇧Z)",
      "Bold (⌘B)",
      "Italic (⌘I)",
      "Link (⌘⇧K)",
      "Bulleted list (⌘⇧8)",
      "Numbered list (⌘⇧7)",
      "Quote (⌘⇧9)",
      "Divider (---)",
    ];

    for (const label of expectedButtons) {
      const button = within(toolbar).getByRole("button", { name: label });
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button).toHaveAttribute("title", label);
    }
  });

  it("renders bubble menu buttons as icon-only controls", async () => {
    const { view } = await setupEditor({ defaultValue: "Make me bold" });

    const textLength = view.state.doc.textContent.length;
    act(() => {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, 1, 1 + textLength)
        )
      );
    });

    const bubbleMenu = await screen.findByRole("toolbar", {
      name: "Inline formatting",
    });
    const buttons = within(bubbleMenu).getAllByRole("button");
    for (const button of buttons) {
      expect(button.querySelector("svg")).not.toBeNull();
      const label = button.querySelector("span");
      expect(label).not.toBeNull();
      expect(label).toHaveClass("sr-only");
    }
  });

  it("creates a new list item when pressing Enter in a list", async () => {
    const { view } = await setupEditor({ defaultValue: "- First" });

    act(() => {
      const endSelection = TextSelection.atEnd(view.state.doc);
      view.dispatch(view.state.tr.setSelection(endSelection));
      view.focus();
      fireEvent.keyDown(view.dom, { key: "Enter" });
    });

    await waitFor(() => {
      const list = view.state.doc.firstChild;
      expect(list?.type.name).toBe("bullet_list");
      expect(list?.childCount).toBe(2);
    });
  });

  it("focuses the editor when autoFocus is provided", async () => {
    const { view } = await setupEditor({ autoFocus: true });

    await waitFor(() => {
      expect(view.hasFocus()).toBe(true);
    });
  });

  it("focuses the editor when clicking the empty surface", async () => {
    const { view, container: surface } = await setupEditor();
    act(() => {
      fireEvent.mouseDown(surface);
      fireEvent.mouseUp(surface);
    });

    await waitFor(() => {
      expect(view.hasFocus()).toBe(true);
    });
  });

  it("highlights the selected slash command using neutral styling", () => {
    render(
      <SlashCommandMenu
        state={{ active: true, query: "", from: 0, to: 0, left: 0, top: 0 }}
        commands={[
          {
            id: "paragraph",
            label: "Paragraph",
            description: "",
            aliases: [],
            command: vi.fn(),
          },
        ]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onRun={vi.fn()}
      />
    );

    const selected = screen.getByRole("option", { selected: true });
    expect(selected.className).toContain("bg-gray-200");
    expect(selected.className).not.toContain("bg-primary-50");
  });
});
