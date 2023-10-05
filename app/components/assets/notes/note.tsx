import { type Note as NoteType, type User } from "@prisma/client";
import { MarkdownViewer } from "~/components/markdown";
import { Switch } from "~/components/shared/switch";
import { Tag } from "~/components/shared/tag";
import { useUserData } from "~/hooks";
import type { WithDateFields } from "~/modules/types";
import { timeAgo } from "~/utils/time-ago";
import { ActionsDopdown } from "./actions-dropdown";

export type NoteWithDate = WithDateFields<NoteType, string> & {
  dateDisplay: string;
};

export const Note = ({ note }: { note: NoteWithDate }) => {
  const user = useUserData();

  return (
    <li key={note.id} className="note mb-6 rounded-lg border bg-white md:mb-8">
      <Switch>
        <Comment
          when={note.type === "COMMENT"}
          note={note}
          user={user as User}
        />
        <Update when={note.type === "UPDATE"} note={note} />
      </Switch>
    </li>
  );
};

const Update = ({ note }: { note: NoteWithDate; when?: boolean }) => (
  <div className="flex px-3.5 py-3">
    <div className="message flex flex-1 items-start gap-2">
      <Tag>{note.dateDisplay}</Tag> <MarkdownViewer content={note.content} />
    </div>
  </div>
);

export const Comment = ({
  note,
  user,
}: {
  note: NoteWithDate;
  user: User;
  when?: boolean;
}) => (
  <>
    <header className="flex justify-between border-b px-3.5 py-3 text-text-xs md:text-text-sm">
      <div>
        <span className="commentator font-medium text-gray-900">
          {user?.firstName} {user?.lastName}
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
