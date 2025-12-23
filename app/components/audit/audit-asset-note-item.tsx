import { useEffect } from "react";
import { Trash } from "lucide-react";
import { useFetcher } from "react-router";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import type { action } from "~/routes/_layout+/audits.$auditId.scan.$auditAssetId.details";
import { tw } from "~/utils/tw";
import { UserBadge } from "../shared/user-badge";

export type NoteData = {
  id: string;
  content: string;
  createdAt: string | Date;
  userId: string;
  type?: "COMMENT" | "UPDATE";
  user: {
    id: string;
    name: string;
    img: string | null;
  };
  /** Indicates this note hasn't been saved to server yet */
  needsServerSync?: boolean;
};

type AuditAssetNoteItemProps = {
  note: NoteData;
  /** Called when server returns the real note data */
  onServerSync?: (realNote: NoteData) => void;
  /** Called when delete is successful */
  onDelete?: (noteId: string) => void;
};

/**
 * Individual note component that manages its own server submission.
 *
 * When a note needs server sync:
 * 1. Component mounts with needsServerSync=true
 * 2. useEffect triggers fetcher to submit note to server
 * 3. Server returns real note with actual ID
 * 4. onServerSync callback updates parent state
 * 5. Component re-renders with real data
 *
 * When deleting a note:
 * 1. User clicks delete button
 * 2. Parent removes note from local state immediately (optimistic)
 * 3. If note is real (exists in DB), submit DELETE request via same fetcher
 * 4. If note is temp (still creating), just remove from state (no API call needed)
 *
 * Each note has its own fetcher with unique key to prevent abort signals.
 */
export function AuditAssetNoteItem({
  note,
  onServerSync,
  onDelete,
}: AuditAssetNoteItemProps) {
  // Unique fetcher key prevents abort signals when multiple notes submit simultaneously
  const fetcher = useFetcher<typeof action>({
    key: `audit-asset-note-${note.id}`,
  });

  // Only allow deletion of COMMENT notes (manual notes), not UPDATE notes (auto-generated)
  const canDelete = note.type === "COMMENT" || note.type === undefined;

  /**
   * Auto-submit note to server when component mounts with needsServerSync=true.
   * This happens in the background without affecting the UI.
   */
  useEffect(() => {
    if (!note.needsServerSync) return;

    const formData = new FormData();
    formData.append("intent", "create-note");
    formData.append("content", note.content);

    void fetcher.submit(formData, {
      method: "POST",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  /**
   * When server responds with real note data, notify parent to update state.
   */
  useEffect(() => {
    // Handle successful response
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      !fetcher.data.error &&
      "note" in fetcher.data &&
      fetcher.data.note.user
    ) {
      // Transform server response inline to keep code clean
      onServerSync?.({
        id: fetcher.data.note.id,
        content: fetcher.data.note.content,
        createdAt: fetcher.data.note.createdAt,
        userId: fetcher.data.note.userId ?? "",
        type: fetcher.data.note.type,
        user: {
          id: fetcher.data.note.user.id,
          name: `${fetcher.data.note.user.firstName} ${fetcher.data.note.user.lastName}`,
          img: fetcher.data.note.user.profilePicture ?? null,
        },
        needsServerSync: false,
      });
    }

    // Handle error response
    if (fetcher.state === "idle" && fetcher.data && fetcher.data.error) {
      // Remove failed note from local state
      onDelete?.(note.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const handleDelete = () => {
    if (!confirm("Are you sure you want to delete this note?")) {
      return;
    }

    // Optimistically remove from parent state immediately
    onDelete?.(note.id);
  };

  return (
    <div className={tw("rounded-md border border-gray-200 bg-gray-50 p-3")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="text-sm text-gray-900">
            <MarkdownViewer content={note.content} disablePortal={true} />
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
            <>
              <span>
                <UserBadge name={note.user.name} img={note.user.img} />
              </span>
              <span>•</span>
              <DateS date={note.createdAt} includeTime />
            </>
          </div>
        </div>
        {onDelete &&
          canDelete &&
          // Only show delete form for real notes (not temp)
          (!note.id.startsWith("temp-") ? (
            <fetcher.Form
              method="POST"
              onSubmit={(e) => {
                if (!confirm("Are you sure you want to delete this note?")) {
                  e.preventDefault();
                  return;
                }
                // Only do optimistic removal if user confirmed (didn't preventDefault)
                onDelete?.(note.id);
              }}
            >
              <input type="hidden" name="intent" value="delete-note" />
              <input type="hidden" name="noteId" value={note.id} />
              <Button type="submit" variant="secondary">
                <Trash className="size-4" />
              </Button>
            </fetcher.Form>
          ) : (
            // Temp notes just remove from state, no server call
            <Button variant="secondary" onClick={handleDelete}>
              <Trash className="size-4" />
            </Button>
          ))}
      </div>
    </div>
  );
}
