import { useLoaderData } from "@remix-run/react";

import { NewNote } from "./new";
import type { NoteWithDate } from "./note";
import { Note } from "./note";

export const Notes = () => {
  const { asset } = useLoaderData();
  const hasNotes = asset?.notes.length > 0;

  return (
    <div>
      <NewNote />
      {hasNotes ? (
        <ul className="notes-list mt-8 w-full">
          {asset.notes.map((note: NoteWithDate) => (
            <Note key={note.id} note={note} />
          ))}
        </ul>
      ) : (
        <div className="flex h-[500px] items-center  justify-center">
          <div className="flex flex-col items-center justify-center p-[16px] text-center md:p-[50px]">
            <img
              src="/images/no-notes.svg"
              alt="Graphic for no notes"
              className="mb-6 w-[172px]"
            />
            <h4>No Notes</h4>
            <p>
              Your asset `{asset.title}` has no notes <br />
              attached to it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
