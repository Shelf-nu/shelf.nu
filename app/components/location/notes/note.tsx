import type { LocationNote } from "@prisma/client";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Switch } from "~/components/shared/switch";
import { Tag } from "~/components/shared/tag";
import type { WithDateFields } from "~/modules/types";
import { timeAgo } from "~/utils/time-ago";
import { LocationNoteActionsDropdown } from "./actions-dropdown";

export type LocationNoteWithDate = WithDateFields<LocationNote, string> & {
  dateDisplay: string;
  user?: {
    firstName: string | null;
    lastName: string | null;
  } | null;
};

export const LocationNoteItem = ({
  note,
  canDelete,
}: {
  note: LocationNoteWithDate;
  canDelete: boolean;
}) => (
  <li className="note mb-2 rounded border bg-white md:mb-4">
    <Switch>
      <Comment note={note} canDelete={canDelete} />
      <Update note={note} />
    </Switch>
  </li>
);

const Update = ({ note }: { note: LocationNoteWithDate }) => (
  <div className="flex px-3.5 py-3">
    <div className="message flex flex-1 items-start gap-2">
      <Tag>{note.dateDisplay}</Tag> <MarkdownViewer content={note.content} />
    </div>
  </div>
);

const Comment = ({
  note,
  canDelete,
}: {
  note: LocationNoteWithDate;
  canDelete: boolean;
}) => (
  <>
    <header className="flex justify-between border-b px-3.5 py-3 text-text-xs md:text-text-sm">
      <div>
        <Tag>{note.dateDisplay}</Tag>{" "}
        <span className="commentator font-medium text-gray-900">
          {note.user
            ? `${note.user?.firstName ?? ""} ${
                note.user?.lastName ?? ""
              }`.trim() || "Unknown"
            : "Unknown"}
        </span>{" "}
        <span className="text-gray-600">{timeAgo(note.createdAt)}</span>
      </div>
      {canDelete ? <LocationNoteActionsDropdown noteId={note.id} /> : null}
    </header>
    <div className="message px-3.5 py-3">
      <MarkdownViewer content={note.content} />
    </div>
  </>
);
