import type { ChangeEvent, FocusEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FetcherWithComponents } from "@remix-run/react";
import { useParams } from "@remix-run/react";
import { atom, useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { MarkdownEditor } from "~/components/markdown/markdown-editor";
import { Button } from "~/components/shared/button";

export const NewBookingNoteSchema = z.object({
  content: z.string().min(3, "Content is required"),
});

// Global editing state atom to maintain editor state across renders
const isEditingAtom = atom(false);

export const NewBookingNote = ({
  fetcher,
}: {
  fetcher: FetcherWithComponents<any>;
}) => {
  const zo = useZorm("NewBookingNote", NewBookingNoteSchema);
  const params = useParams();
  const hasError = zo.errors.content()?.message;
  const [isEditing, setIsEditing] = useAtom(isEditingAtom);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isDone = fetcher.state === "idle" && fetcher.data != null;

  // Controls whether actions are disabled during form submission
  const [disabled, setDisabled] = useState<boolean>(false);

  /**
   * Handles form submission by disabling UI controls
   * Prevents double submissions while optimistic UI is active
   */
  function handleSubmit() {
    setDisabled(true);
  }

  /**
   * Smart blur handler that keeps editor open when clicking interactive elements
   * Only collapses editor when clicking outside and content is empty
   *
   * SPECIAL HANDLING:
   * - Markdown preview links (A tags)
   * - Submit/Cancel buttons (BUTTON tags)
   * - Markdown preview tabs (tabpanel role)
   */
  const handelBlur = (
    e: ChangeEvent<HTMLTextAreaElement> & FocusEvent<HTMLTextAreaElement>
  ) => {
    const content = e.currentTarget.value;

    // Check if user clicked on interactive elements that should keep editor open
    const clickedTargetILink =
      e?.relatedTarget?.tagName === "A" ||
      e?.relatedTarget?.tagName === "BUTTON" ||
      e?.relatedTarget?.role === "tabpanel";

    if (clickedTargetILink) return;

    // Only collapse editor if content is empty
    if (content === "") {
      setIsEditing(false);
    }
  };

  /**
   * Keyboard shortcut handler for quick submission
   * Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) submits form
   * Only works when content is not empty
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const content = event.currentTarget.value;
      if (
        content !== "" &&
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        fetcher.submit(event.currentTarget.form);
      }
    },
    [fetcher]
  );

  // Auto-focus editor when entering edit mode for better UX
  useEffect(() => {
    if (isEditing) {
      editorRef?.current?.focus();
    }
  }, [isEditing]);

  // Auto-collapse editor when form submission completes
  useEffect(() => {
    setIsEditing(false);
  }, [isDone, setIsEditing]);

  return (
    <div ref={wrapperRef}>
      <fetcher.Form
        action={`/bookings/${params.bookingId}/note`}
        method="post"
        ref={zo.ref}
        onSubmit={handleSubmit}
      >
        {isEditing ? (
          <div className="relative flex flex-col pb-12 xl:pb-0">
            <div className="absolute bottom-0 right-0 flex gap-1 xl:bottom-auto">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(false)}
                disabled={disabled}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="" disabled={disabled}>
                Create note
              </Button>
            </div>
            <MarkdownEditor
              label={"note"}
              defaultValue={""}
              name={zo.fields.content()}
              placeholder="Leave a note"
              rows={4}
              ref={editorRef}
              className="rounded-b-none"
              onBlur={handelBlur}
              onKeyDown={handleKeyDown}
              disabled={disabled}
            />
          </div>
        ) : (
          <Input
            icon="write"
            className="text-gray-700"
            label=""
            placeholder="Leave a note"
            onFocus={() => setIsEditing(true)}
          />
        )}

        {hasError ? (
          <div className="text-sm text-error-500">
            {zo.errors.content()?.message}
          </div>
        ) : null}
      </fetcher.Form>
    </div>
  );
};
