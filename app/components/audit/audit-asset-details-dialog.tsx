import type { KeyboardEventHandler } from "react";
import { useRef, useState, type FormEvent } from "react";
import type { AuditAsset } from "@prisma/client";
import { Form } from "react-router";
import { Button } from "~/components/shared/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "~/components/shared/sheet";
import { useUserData } from "~/hooks/use-user-data";
import { AuditAssetNoteItem, type NoteData } from "./audit-asset-note-item";

type AuditAssetDetailsDialogProps = {
  open: boolean;
  onClose: () => void;
  auditAssetId: AuditAsset["id"];
  auditSessionId: string;
  assetName: string;
  /** Pre-fetched notes from scan route loader */
  initialNotes?: NoteData[];
};

/**
 * Refactored dialog using local state and individual note components.
 *
 * New architecture:
 * - Uses local state (localNotes) for optimistic UI
 * - Each NoteItem manages its own server submission with unique fetcher
 * - Form submission is purely client-side, updates local state
 * - No loading states needed (notes/images pre-fetched in scan route)
 */
export function AuditAssetDetailsDialog({
  open,
  onClose,
  auditAssetId: _auditAssetId,
  auditSessionId: _auditSessionId,
  assetName,
  initialNotes = [],
}: AuditAssetDetailsDialogProps) {
  /**
   * Local state for notes - starts with pre-fetched data.
   * When user adds a note, it's added here immediately (optimistic).
   * Each NoteItem handles its own server sync in the background.
   */
  const [localNotes, setLocalNotes] = useState<NoteData[]>(initialNotes);
  const user = useUserData();
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * Handle form submission - purely client-side, no server call.
   * Creates temporary note and adds to local state.
   * NoteItem component will handle server submission.
   */
  const handleAddNote = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const content = formData.get("content") as string;

    if (!content?.trim()) return;

    // Create temporary note with needsServerSync flag
    const tempNote: NoteData = {
      id: `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      content,
      createdAt: new Date().toISOString(),
      userId: user!.id,
      user: {
        id: user!.id,
        name: `${user!.firstName || ""} ${user!.lastName || ""}`,
        img: user!.profilePicture || null,
      },
      needsServerSync: true,
    };

    // Add to local state immediately (optimistic)
    setLocalNotes((prev) => [tempNote, ...prev]);

    // Reset form
    e.currentTarget.reset();
  };

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const form = formRef.current;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  /**
   * Called by NoteItem when server returns real note data.
   * Replaces temporary note with real note from server.
   */
  const handleNoteServerSync = (tempId: string, realNote: NoteData) => {
    setLocalNotes((prev) =>
      prev.map((note) =>
        note.id === tempId ? { ...realNote, needsServerSync: false } : note
      )
    );
  };

  /**
   * Called by NoteItem when delete is successful.
   * Removes note from local state.
   */
  const handleNoteDelete = (noteId: string) => {
    setLocalNotes((prev) => prev.filter((note) => note.id !== noteId));
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent className="w-full overflow-y-auto bg-white sm:max-w-lg">
        <div className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>Asset Details: {assetName}</SheetTitle>
          </SheetHeader>

          <div className="mt-6 flex-1 space-y-6">
            {/* Notes Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-900">Notes</h4>
              <Form onSubmit={handleAddNote} ref={formRef}>
                <textarea
                  name="content"
                  placeholder="Add a note about this asset..."
                  className="min-h-[80px] w-full rounded-md border border-gray-300 p-2 text-sm focus:border-gray-500 focus:outline-none"
                  onKeyDown={handleKeyDown}
                />
                <Button type="submit" className="mt-2">
                  Add Note
                </Button>
              </Form>

              <div className="space-y-2">
                {localNotes.map((note) => (
                  <AuditAssetNoteItem
                    key={note.id}
                    note={note}
                    onServerSync={(realNote) =>
                      handleNoteServerSync(note.id, realNote)
                    }
                    onDelete={handleNoteDelete}
                  />
                ))}
              </div>
            </div>

            {/* Images Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-900">Images</h4>
              {/* TODO: Implement images with similar pattern as notes */}
              <p className="text-sm text-gray-500">
                Image upload coming soon...
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
