import { useEffect } from "react";
import { Trash } from "lucide-react";
import { useFetcher } from "react-router";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import type { action } from "~/routes/api+/audits.$auditId.assets.$assetId.notes";
import { tw } from "~/utils/tw";
import { UserBadge } from "../shared/user-badge";

export type NoteData = {
  id: string;
  content: string;
  createdAt: string | Date;
  userId: string;
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
  auditSessionId: string;
  auditAssetId: string;
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
 * Each note has its own fetcher with unique key to prevent abort signals.
 */
export function AuditAssetNoteItem({
  note,
  auditSessionId,
  auditAssetId,
  onServerSync,
  onDelete,
}: AuditAssetNoteItemProps) {
  // Unique fetcher key prevents abort signals when multiple notes submit simultaneously
  const fetcher = useFetcher<typeof action>({
    key: `audit-asset-note-${note.id}`,
  });

  /**
   * Auto-submit note to server when component mounts with needsServerSync=true.
   * This happens in the background without affecting the UI.
   */
  useEffect(() => {
    if (!note.needsServerSync) return;

    const formData = new FormData();
    formData.append("intent", "create");
    formData.append("content", note.content);

    void fetcher.submit(formData, {
      method: "POST",
      action: `/api/audits/${auditSessionId}/assets/${auditAssetId}/notes`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  /**
   * When server responds with real note data, notify parent to update state.
   */
  useEffect(() => {
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
        user: {
          id: fetcher.data.note.user.id,
          name: `${fetcher.data.note.user.firstName} ${fetcher.data.note.user.lastName}`,
          img: fetcher.data.note.user.profilePicture ?? null,
        },
        needsServerSync: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <div className={tw("rounded-md border border-gray-200 bg-gray-50 p-3")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm text-gray-900">{note.content}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <>
              <span>
                <UserBadge name={note.user.name} img={note.user.img} />
              </span>
              <span>•</span>
              <DateS date={note.createdAt} includeTime />
            </>
          </div>
        </div>
        {/* Only show delete button for saved notes */}
        {!note.needsServerSync && onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-gray-400 hover:text-red-600"
            onClick={() => {
              if (confirm("Are you sure you want to delete this note?")) {
                onDelete(note.id);
              }
            }}
          >
            <Trash className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
