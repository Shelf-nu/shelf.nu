import type { Note } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { MarkdownViewer } from "~/components/markdown";
import { DeleteNote } from "./delete-note";
import { NewNote } from "./new";

export const Notes = () => {
  const { item } = useLoaderData();
  const hasNotes = item?.notes.length > 0;

  return (
    <div>
      Notes
      {hasNotes ? (
        item?.notes.map((note: Note) => (
          <div className="flex gap-3" key={note.id}>
            <MarkdownViewer content={note.content} />
            <DeleteNote note={note} />
          </div>
        ))
      ) : (
        <div>No notes yet</div>
      )}
      <NewNote />
    </div>
  );
};
