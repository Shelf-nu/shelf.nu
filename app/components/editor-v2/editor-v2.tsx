import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { TextareaHTMLAttributes } from "react";
import "prosemirror-view/style/prosemirror.css";
import { toggleMark, wrapIn } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { wrapInList } from "prosemirror-schema-list";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { createEditorSchema } from "~/modules/editor-v2/markdoc-utils";
import { tw } from "~/utils/tw";

import { BubbleMenu } from "./components/bubble-menu";
import { LinkDialog, RawBlockDialog } from "./components/dialogs";
import { SlashCommandMenu } from "./components/slash-command-menu";
import { EditorToolbar } from "./components/toolbar";
import { createHorizontalRuleCommand, createSlashCommands } from "./helpers";
import { useBubbleMenu } from "./hooks/use-bubble-menu";
import { useEditorCommands } from "./hooks/use-editor-commands";
import { useEditorView } from "./hooks/use-editor-view";
import { useLinkDialog } from "./hooks/use-link-dialog";
import { useRawBlockDialog } from "./hooks/use-raw-block-dialog";
import { useSlashCommands } from "./hooks/use-slash-commands";
import { useToolbarState } from "./hooks/use-toolbar-state";

interface EditorV2Props
  extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "defaultValue" | "onChange"
  > {
  label: string;
  name: string;
  defaultValue: string;
  onChange?: (value: string) => void;
}

const HINT_TEXT = "Use / to access commands.";

export const EditorV2 = forwardRef<HTMLTextAreaElement, EditorV2Props>(
  function EditorV2(
    {
      defaultValue,
      label,
      name,
      placeholder,
      disabled,
      className,
      maxLength,
      onBlur,
      onFocus,
      onChange,
      ...textareaProps
    },
    ref
  ) {
    const { autoFocus: shouldAutoFocus, ...restTextareaProps } =
      textareaProps as typeof textareaProps & { autoFocus?: boolean };

    const schema = useMemo(() => createEditorSchema(), []);
    const editorContainerRef = useRef<HTMLDivElement | null>(null);
    const hiddenTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);

    const commands = useMemo(() => createSlashCommands(schema), [schema]);

    // Initialize hooks (all hooks share the same viewRef)
    const { toolbarState, applyToolbarState } = useToolbarState();
    const { bubbleState, updateBubble } = useBubbleMenu();

    const {
      linkDialog,
      openLinkDialog,
      closeLinkDialog,
      applyLink,
      setLinkHref,
    } = useLinkDialog(schema, viewRef);

    const {
      rawBlockDialog,
      openRawBlockEditor,
      closeRawBlockEditor,
      applyRawBlockEdit,
      setRawBlockContent,
    } = useRawBlockDialog(viewRef);

    const {
      slashState,
      slashIndex,
      filteredCommands,
      updateSlash,
      applySlashCommand,
      handleSlashKeyDown,
      setSlashIndex,
    } = useSlashCommands(commands, viewRef);

    const { runCommand, handleParagraphChange } = useEditorCommands(
      schema,
      viewRef
    );

    const { markdocValue } = useEditorView(editorContainerRef, viewRef, {
      schema,
      defaultValue,
      disabled,
      placeholder,
      maxLength,
      shouldAutoFocus,
      onBlur,
      onFocus,
      onChange,
      onStateUpdate: (state: EditorState, view: EditorView) => {
        applyToolbarState(state);
        updateBubble(state, view);
        updateSlash(state, view);
      },
      onKeyDown: handleSlashKeyDown,
      openLinkDialog,
      openRawBlockEditor,
    });

    useImperativeHandle(ref, () => {
      const element = hiddenTextareaRef.current;
      if (!element) {
        return null as unknown as HTMLTextAreaElement;
      }
      return Object.assign(element, {
        focus: () => {
          if (viewRef.current) {
            viewRef.current.focus();
          } else {
            element.focus();
          }
        },
      });
    });

    useEffect(() => {
      if (hiddenTextareaRef.current) {
        hiddenTextareaRef.current.value = markdocValue;
      }
    }, [markdocValue]);

    useLayoutEffect(() => {
      if (shouldAutoFocus && viewRef.current) {
        viewRef.current.focus();
      }
    }, [shouldAutoFocus, viewRef]);

    return (
      <div className={tw("flex flex-col gap-2", className)}>
        <div className="isolate overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 bg-white px-3 py-2">
            <EditorToolbar
              state={toolbarState}
              onUndo={() => runCommand(undo)}
              onRedo={() => runCommand(redo)}
              onParagraphChange={handleParagraphChange}
              onBold={() => runCommand(toggleMark(schema.marks.strong))}
              onItalic={() => runCommand(toggleMark(schema.marks.em))}
              onToggleLink={openLinkDialog}
              onBulletList={() =>
                runCommand(wrapInList(schema.nodes.bullet_list))
              }
              onOrderedList={() =>
                runCommand(wrapInList(schema.nodes.ordered_list))
              }
              onQuote={() => runCommand(wrapIn(schema.nodes.blockquote))}
              onDivider={
                schema.nodes.horizontal_rule
                  ? () => runCommand(createHorizontalRuleCommand(schema))
                  : undefined
              }
              hasDivider={Boolean(schema.nodes.horizontal_rule)}
            />
          </div>
          <div
            className="relative bg-gray-50 px-3 py-4 focus-within:ring-2 focus-within:ring-gray-300"
            onMouseDown={(event) => {
              if (!(event.target instanceof HTMLElement)) {
                return;
              }
              if (event.target.closest('[contenteditable="true"]')) {
                return;
              }
              event.preventDefault();
              viewRef.current?.focus();
            }}
          >
            <div
              ref={editorContainerRef}
              className="min-h-[200px]"
              data-testid="editor-v2-content"
              onMouseDown={(event) => {
                if (!(event.target instanceof HTMLElement)) {
                  return;
                }
                if (event.target.closest('[contenteditable="true"]')) {
                  return;
                }
                event.preventDefault();
                viewRef.current?.focus();
              }}
            />
            <BubbleMenu
              state={bubbleState}
              onBold={() => runCommand(toggleMark(schema.marks.strong))}
              onItalic={() => runCommand(toggleMark(schema.marks.em))}
              onLink={openLinkDialog}
              boldActive={toolbarState.bold}
              italicActive={toolbarState.italic}
              linkActive={toolbarState.link}
            />
            <SlashCommandMenu
              state={slashState}
              commands={filteredCommands}
              selectedIndex={slashIndex}
              onSelect={setSlashIndex}
              onRun={applySlashCommand}
            />
          </div>
        </div>
        <textarea
          ref={hiddenTextareaRef}
          name={name}
          value={markdocValue}
          readOnly
          hidden
          disabled={disabled}
          aria-hidden="true"
          data-testid="editor-v2-input"
          {...restTextareaProps}
        />
        <div className="flex flex-col gap-1 text-xs text-gray-500">
          <span>
            {label} supports Markdown and Markdoc. {HINT_TEXT}
          </span>
          {maxLength ? (
            <span
              className={
                markdocValue.length > maxLength ? "text-error-600" : undefined
              }
            >
              {markdocValue.length}/{maxLength}
            </span>
          ) : null}
        </div>
        <LinkDialog
          state={linkDialog}
          onClose={closeLinkDialog}
          onHrefChange={setLinkHref}
          onApply={applyLink}
        />
        <RawBlockDialog
          state={rawBlockDialog}
          onClose={closeRawBlockEditor}
          onChange={setRawBlockContent}
          onSave={applyRawBlockEdit}
        />
      </div>
    );
  }
);
