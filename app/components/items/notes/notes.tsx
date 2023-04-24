import type { Note } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { MarkdownViewer } from "~/components/markdown";
import { useUserData } from "~/hooks";
import { timeAgo } from "~/utils/time-ago";
import { DeleteNote } from "./delete-note";
import { NewNote } from "./new";

export const Notes = () => {
  const { item } = useLoaderData();
  const user = useUserData();
  const hasNotes = item?.notes.length > 0;

  return (
    <div>
      <NewNote />
      {hasNotes ? (
        <ul className="notes-list mt-8 w-full">
          {item.notes.map((note: Note) => (
            <li key={note.id} className="note mb-8 rounded-lg border bg-white">
              <header className="border-b px-3.5 py-3">
                <span className="commentator  font-medium text-gray-900">
                  {user?.firstName} {user?.lastName}
                </span>{" "}
                <span className="text-gray-600">{timeAgo(note.createdAt)}</span>
              </header>
              <div className="message px-3.5 py-3">
                <MarkdownViewer content={note.content} />
              </div>
              <DeleteNote note={note} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center justify-center p-[120px] text-center">
          <img
            src="/images/no-notes.svg"
            alt="Graphic for no notes"
            className="mb-6 w-[172px]"
          />
          <h4>No Notes</h4>
          <p>
            Your asset `{item.title}` has no notes <br />
            attached to it.
          </p>
        </div>
      )}
    </div>
  );
};
