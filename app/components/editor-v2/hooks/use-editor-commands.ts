import { useCallback } from "react";
import { setBlockType, wrapIn } from "prosemirror-commands";
import type { Schema } from "prosemirror-model";
import { wrapInList } from "prosemirror-schema-list";
import type { EditorView } from "prosemirror-view";

import type { ToolbarBlock } from "../types";

export function useEditorCommands(
  schema: Schema,
  viewRef: React.RefObject<EditorView | null>
) {
  const runCommand = useCallback(
    (command: any) => {
      const view = viewRef.current;
      if (!view) return;
      command(view.state, view.dispatch, view);
      view.focus();
    },
    [viewRef]
  );

  const handleParagraphChange = useCallback(
    (value: ToolbarBlock) => {
      const view = viewRef.current;
      if (!view) return;
      const { state } = view;
      switch (value) {
        case "paragraph":
          setBlockType(schema.nodes.paragraph)(state, view.dispatch, view);
          break;
        case "heading1":
        case "heading2":
        case "heading3":
        case "heading4": {
          const level = Number(value.replace("heading", ""));
          setBlockType(schema.nodes.heading, { level })(
            state,
            view.dispatch,
            view
          );
          break;
        }
        case "bullet_list":
          wrapInList(schema.nodes.bullet_list)(state, view.dispatch, view);
          break;
        case "ordered_list":
          wrapInList(schema.nodes.ordered_list)(state, view.dispatch, view);
          break;
        case "blockquote":
          wrapIn(schema.nodes.blockquote)(state, view.dispatch, view);
          break;
      }
      view.focus();
    },
    [
      schema.nodes.blockquote,
      schema.nodes.bullet_list,
      schema.nodes.heading,
      schema.nodes.ordered_list,
      schema.nodes.paragraph,
      viewRef,
    ]
  );

  return {
    runCommand,
    handleParagraphChange,
  };
}
