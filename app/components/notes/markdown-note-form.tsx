import type { ChangeEvent, FocusEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FetcherWithComponents } from "@remix-run/react";
import { useAtom, type PrimitiveAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";

import Input from "~/components/forms/input";
import { MarkdownEditor } from "~/components/markdown/markdown-editor";
import { Button } from "~/components/shared/button";

export const MarkdownNoteSchema = z.object({
  content: z.string().min(3, "Content is required"),
});

interface MarkdownNoteFormProps {
  fetcher: FetcherWithComponents<any>;
  /** Jotai atom for managing editing state - shared across component instances */
  editingAtom: PrimitiveAtom<boolean>;
  /** Form submission endpoint (e.g., /assets/:id/note) */
  action: string;
  /** Unique form identifier for Zorm validation */
  formId: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  editorLabel?: string;
}

/**
 * Shared markdown note form component used for creating notes on assets and bookings.
 *
 * Features:
 * - Dual mode: collapsed input that expands to full markdown editor on focus
 * - Keyboard shortcut support (Cmd/Ctrl+Enter to submit)
 * - Smart blur handling (stays open when clicking editor controls)
 * - Optimistic UI with disabled state during submission
 *
 * The editing state is managed via a Jotai atom passed from the parent,
 * allowing the state to persist across re-renders.
 */
export function MarkdownNoteForm({
  fetcher,
  editingAtom,
  action,
  formId,
  placeholder = "Leave a note",
  submitLabel = "Create note",
  cancelLabel = "Cancel",
  editorLabel = "note",
}: MarkdownNoteFormProps) {
  const zo = useZorm(formId, MarkdownNoteSchema);
  const hasError = zo.errors.content()?.message;
  const [isEditing, setIsEditing] = useAtom(editingAtom);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const isDone = fetcher.state === "idle" && fetcher.data != null;

  // Tracks whether form controls should be disabled during submission
  const [disabled, setDisabled] = useState(false);

  /**
   * Handles form submission with optimistic UI updates.
   *
   * Immediately:
   * - Closes the editor (optimistic UX)
   * - Disables form controls to prevent double submissions
   *
   * The editor will be re-enabled when fetcher completes (see useEffect below)
   */
  const handleSubmit = () => {
    setIsEditing(false); // Close editor optimistically
    setDisabled(true);
  };

  /**
   * Smart blur handler that only collapses the editor when appropriate.
   *
   * Stays open when user clicks:
   * - Markdown preview links (A tags)
   * - Submit/Cancel buttons (BUTTON tags)
   * - Markdown preview tabs (elements with tabpanel role)
   *
   * Only collapses when:
   * - Content is empty AND
   * - User clicks outside the editor controls
   */
  const handleBlur = (
    event: ChangeEvent<HTMLTextAreaElement> & FocusEvent<HTMLTextAreaElement>
  ) => {
    const content = event.currentTarget.value;
    const clickedTarget =
      event?.relatedTarget?.tagName === "A" ||
      event?.relatedTarget?.tagName === "BUTTON" ||
      event?.relatedTarget?.role === "tabpanel";

    // Don't collapse if user clicked on editor controls
    if (clickedTarget) return;

    // Collapse editor only if content is empty
    if (content === "") {
      setIsEditing(false);
    }
  };

  /**
   * Keyboard shortcut handler for quick submission.
   *
   * Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) submits the form
   * Returns true when the event is handled to prevent default behavior
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      // Check for Cmd+Enter or Ctrl+Enter
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        // Optimistically close the editor
        setIsEditing(false);
        // Disable form to prevent double submissions
        setDisabled(true);
        // Submit the form
        if (formElement) {
          fetcher.submit(formElement);
        }
        return true; // Event handled, prevent default
      }
      return false; // Event not handled
    },
    [fetcher, formElement, setIsEditing]
  );

  /**
   * Auto-focus the editor when entering edit mode for better UX.
   *
   * Uses requestAnimationFrame to ensure the DOM has been updated
   * before attempting to focus (prevents race conditions).
   */
  useEffect(() => {
    if (!isEditing) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  /**
   * Ensure editor is closed when form submission completes successfully.
   *
   * This acts as a backup to the optimistic close in handleSubmit.
   * isDone is true when fetcher returns to idle state with data,
   * indicating the note was created successfully.
   */
  useEffect(() => {
    if (isDone) {
      setIsEditing(false);
    }
  }, [isDone, setIsEditing]);

  /**
   * Re-enable form controls when fetcher completes.
   *
   * This resets the disabled state after submission finishes,
   * allowing the user to create another note if needed.
   */
  useEffect(() => {
    if (fetcher.state === "idle") {
      setDisabled(false);
    }
  }, [fetcher.state]);

  // Combine refs for both Zorm and our form state
  const combinedFormRef = useCallback(
    (node: HTMLFormElement | null) => {
      setFormElement(node);
      zo.ref(node);
    },
    [zo]
  );

  return (
    <div>
      <fetcher.Form
        action={action}
        method="post"
        ref={combinedFormRef}
        onSubmit={handleSubmit}
      >
        {isEditing ? (
          <div className="relative flex flex-col pb-12 xl:pb-0">
            <MarkdownEditor
              label={editorLabel}
              defaultValue=""
              name={zo.fields.content()}
              placeholder={placeholder}
              rows={4}
              ref={editorRef}
              className="rounded-b-none"
              onBlur={handleBlur}
              onKeyDown={handleKeyDown as any}
              disabled={disabled}
            />
            {/* Action buttons positioned in top-right corner */}
            <div className="flex justify-end gap-1 md:absolute md:right-2 md:top-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(false)}
                disabled={disabled}
              >
                {cancelLabel}
              </Button>
              <Button type="submit" size="sm" disabled={disabled}>
                {submitLabel}
              </Button>
            </div>
          </div>
        ) : (
          // Collapsed mode: Simple input that expands on focus
          <Input
            icon="write"
            className="text-gray-700"
            label=""
            placeholder={placeholder}
            onFocus={() => setIsEditing(true)}
          />
        )}

        {hasError ? (
          <div className="text-sm text-error-500">{hasError}</div>
        ) : null}
      </fetcher.Form>
    </div>
  );
}
