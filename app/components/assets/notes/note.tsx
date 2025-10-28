import type { ReactNode } from "react";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { DateS } from "~/components/shared/date";
import { Switch } from "~/components/shared/switch";
import { Tag } from "~/components/shared/tag";
import { timeAgo } from "~/utils/time-ago";

/**
 * Generic note type that works for both asset notes and booking notes
 */
export type NoteWithUser = {
  id: string;
  content: string;
  type: "COMMENT" | "UPDATE";
  createdAt: string | Date;
  user?: {
    firstName: string;
    lastName: string;
  };
};

interface NoteProps {
  note: NoteWithUser;
  /** Optional actions dropdown component to render in the comment header */
  actionsDropdown?: ReactNode;
}

export const Note = ({ note, actionsDropdown }: NoteProps) => (
  <li key={note.id} className="note mb-2 rounded border bg-white md:mb-4">
    <Switch>
      <Comment
        when={note.type === "COMMENT"}
        note={note}
        actionsDropdown={actionsDropdown}
      />
      <Update when={note.type === "UPDATE"} note={note} />
    </Switch>
  </li>
);

const Update = ({ note }: { note: NoteWithUser; when?: boolean }) => (
  <div className="flex px-3.5 py-3">
    <div className="message flex flex-1 items-start gap-2">
      <Tag>
        <DateS date={note.createdAt} includeTime />
      </Tag>{" "}
      <MarkdownViewer content={note.content} />
    </div>
  </div>
);

const Comment = ({
  note,
  actionsDropdown,
}: {
  note: NoteWithUser;
  actionsDropdown?: ReactNode;
  when?: boolean;
}) => (
  <>
    <header className="flex justify-between border-b px-3.5 py-3 text-text-xs md:text-text-sm">
      <div>
        <Tag>
          <DateS date={note.createdAt} includeTime />
        </Tag>{" "}
        <span className="commentator font-medium text-gray-900">
          {note.user
            ? `${note.user.firstName} ${note.user.lastName}`
            : "Unknown"}
        </span>{" "}
        <span className="text-gray-600">{timeAgo(note.createdAt)}</span>
      </div>
      {actionsDropdown}
    </header>
    <div className="message px-3.5 py-3">
      <MarkdownViewer content={note.content} />
    </div>
  </>
);
