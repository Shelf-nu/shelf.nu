import type { BookingNote as BookingNoteType } from "@prisma/client";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Switch } from "~/components/shared/switch";
import { Tag } from "~/components/shared/tag";
import type { WithDateFields } from "~/modules/types";
import { timeAgo } from "~/utils/time-ago";
import { BookingActionsDropdown } from "./actions-dropdown";

/**
 * BOOKING NOTE TYPE DEFINITIONS
 *
 * BookingNoteWithDate extends the base BookingNote with UI-specific fields:
 * - dateDisplay: Formatted date string for UI display
 * - user: Optional user info for manual notes (system notes have no user)
 *
 * NOTE TYPES:
 * - COMMENT: Manual user notes (show user attribution and actions)
 * - UPDATE: System-generated activity logs (no user attribution, no actions)
 */
export type BookingNoteWithDate = WithDateFields<BookingNoteType, string> & {
  dateDisplay: string;
  user?: {
    firstName: string;
    lastName: string;
  };
};

export const BookingNote = ({ note }: { note: BookingNoteWithDate }) => (
  <li key={note.id} className="note mb-2 rounded border bg-white md:mb-4">
    <Switch>
      <BookingComment when={note.type === "COMMENT"} note={note} />
      <BookingUpdate when={note.type === "UPDATE"} note={note} />
    </Switch>
  </li>
);

const BookingUpdate = ({
  note,
}: {
  note: BookingNoteWithDate;
  when?: boolean;
}) => (
  <div className="flex px-3.5 py-3">
    <div className="message flex flex-1 items-start gap-2">
      <Tag>{note.dateDisplay}</Tag> <MarkdownViewer content={note.content} />
    </div>
  </div>
);

export const BookingComment = ({
  note,
}: {
  note: BookingNoteWithDate;
  when?: boolean;
}) => (
  <>
    <header className="flex justify-between border-b px-3.5 py-3 text-text-xs md:text-text-sm">
      <div>
        <Tag>{note.dateDisplay}</Tag>{" "}
        <span className="commentator font-medium text-gray-900">
          {note.user
            ? `${note.user?.firstName} ${note.user?.lastName}`
            : "Unknown"}
        </span>{" "}
        <span className="text-gray-600">{timeAgo(note.createdAt)}</span>
      </div>
      <BookingActionsDropdown noteId={note.id} />
    </header>
    <div className="message px-3.5 py-3">
      <MarkdownViewer content={note.content} />
    </div>
  </>
);
