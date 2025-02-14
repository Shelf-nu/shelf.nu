import type { Note as NoteType } from "@prisma/client";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Switch } from "~/components/shared/switch";
import { Tag } from "~/components/shared/tag";
import type { WithDateFields } from "~/modules/types";
import { timeAgo } from "~/utils/time-ago";
import { ActionsDopdown } from "./actions-dropdown";

export type NoteWithDate = WithDateFields<NoteType, string> & {
  dateDisplay: string;
  user?: {
    firstName: string;
    lastName: string;
  };
};

export const Note = ({ note }: { note: NoteWithDate }) => (
  <li key={note.id} className="note mb-2 rounded border bg-white md:mb-4">
    <Switch>
      <Comment when={note.type === "COMMENT"} note={note} />
      <Update when={note.type === "UPDATE"} note={note} />
    </Switch>
  </li>
);

const Update = ({ note }: { note: NoteWithDate; when?: boolean }) => (
  <div className="flex px-3.5 py-3">
    <div className="message flex flex-1 items-start gap-2">
      <Tag>{note.dateDisplay}</Tag> <MarkdownViewer content={note.content} />
    </div>
  </div>
);

export const Comment = ({ note }: { note: NoteWithDate; when?: boolean }) => (
  <>
    <header className="flex justify-between border-b px-3.5 py-3 text-text-xs md:text-text-sm">
      <div>
        <span className="commentator font-medium text-gray-900">
          {note.user
            ? `${note.user?.firstName} ${note.user?.lastName}`
            : "Unknown"}
        </span>{" "}
        <span className="text-gray-600">{timeAgo(note.createdAt)}</span>
      </div>
      <ActionsDopdown noteId={note.id} />
    </header>
    <div className="message px-3.5 py-3">
      <MarkdownViewer content={note.content} />
    </div>
  </>
);
