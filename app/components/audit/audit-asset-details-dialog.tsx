import { useState } from "react";
import type { AuditAsset } from "@prisma/client";
import { X } from "lucide-react";
import { Button } from "~/components/shared/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "~/components/shared/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { tw } from "~/utils/tw";

type AuditAssetDetailsDialogProps = {
  open: boolean;
  onClose: () => void;
  auditAssetId: AuditAsset["id"];
  auditSessionId: string;
  assetName: string;
  defaultTab?: "notes" | "images";
};

/**
 * Dialog for managing notes and images for a specific asset in an audit.
 * Has two tabs: Notes and Images.
 */
export function AuditAssetDetailsDialog({
  open,
  onClose,
  auditAssetId: _auditAssetId,
  auditSessionId: _auditSessionId,
  assetName,
  defaultTab = "notes",
}: AuditAssetDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<"notes" | "images">(defaultTab);
  const [noteContent, setNoteContent] = useState("");
  const [mockNotes, setMockNotes] = useState([
    {
      id: "1",
      content: "This asset has a small scratch on the left side.",
      createdAt: new Date("2024-01-15T10:30:00"),
      user: { firstName: "John", lastName: "Doe" },
    },
    {
      id: "2",
      content: "Serial number verified and matches the documentation.",
      createdAt: new Date("2024-01-15T11:45:00"),
      user: { firstName: "Jane", lastName: "Smith" },
    },
  ]);

  const handleSubmitNote = () => {
    if (!noteContent.trim()) return;

    // Mock adding a note
    setMockNotes([
      {
        id: String(Date.now()),
        content: noteContent,
        createdAt: new Date(),
        user: { firstName: "You", lastName: "" },
      },
      ...mockNotes,
    ]);

    setNoteContent("");
  };

  const handleDeleteNote = (noteId: string) => {
    setMockNotes(mockNotes.filter((note) => note.id !== noteId));
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent
        side="right"
        hideCloseButton
        className={tw(
          "w-full overflow-hidden bg-white sm:max-w-2xl",
          "flex flex-col"
        )}
      >
        <SheetHeader>
          <SheetTitle>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">{assetName}</h3>
                <p className="text-sm text-gray-500">Audit details</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="-mr-2"
                onClick={onClose}
              >
                <X className="size-5" />
              </Button>
            </div>
          </SheetTitle>
        </SheetHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "notes" | "images")}
        >
          <TabsList className="w-full">
            <TabsTrigger value="notes" className="flex-1">
              Notes
            </TabsTrigger>
            <TabsTrigger value="images" className="flex-1">
              Images
            </TabsTrigger>
          </TabsList>

          {/* Notes Tab */}
          <TabsContent value="notes" className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              {/* Note input */}
              <div>
                <label
                  htmlFor="note-content"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Add a note
                </label>
                <textarea
                  id="note-content"
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Write your audit note here..."
                  rows={4}
                  className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                />
                <Button
                  type="button"
                  onClick={handleSubmitNote}
                  disabled={!noteContent.trim()}
                  className="mt-2"
                >
                  Add Note
                </Button>
              </div>

              {/* Notes list */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Notes</h4>
                {mockNotes.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No notes yet. Add one above!
                  </p>
                ) : (
                  <div className="space-y-3">
                    {mockNotes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-md border border-gray-200 bg-gray-50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-sm text-gray-900">
                              {note.content}
                            </p>
                            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                              <span>
                                {note.user.firstName} {note.user.lastName}
                              </span>
                              <span>•</span>
                              <span>
                                {note.createdAt.toLocaleDateString()} at{" "}
                                {note.createdAt.toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => handleDeleteNote(note.id)}
                            className="text-gray-400 hover:text-red-600"
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Images Tab */}
          <TabsContent value="images" className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-medium text-gray-700">
                  Images
                </h4>
                {/* Mock image thumbnails */}
                <div className="flex flex-wrap gap-2">
                  <div className="relative size-24 overflow-hidden rounded-md border border-gray-200">
                    <div className="flex size-full items-center justify-center bg-gray-100 text-gray-400">
                      <span className="text-xs">Image 1</span>
                    </div>
                  </div>
                  <div className="relative size-24 overflow-hidden rounded-md border border-gray-200">
                    <div className="flex size-full items-center justify-center bg-gray-100 text-gray-400">
                      <span className="text-xs">Image 2</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="flex size-24 items-center justify-center rounded-md border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 hover:border-gray-400 hover:bg-gray-100"
                  >
                    <span className="text-2xl">+</span>
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Click thumbnails to view full size. Max 3 images per asset.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
