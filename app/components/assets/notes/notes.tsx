import type { Note } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { MarkdownViewer } from "~/components/markdown";
import { useUserData } from "~/hooks";
import { timeAgo } from "~/utils/time-ago";
import { ActionsDopdown } from "./actions-dropdown";
import { NewNote } from "./new";

export const Notes = () => {
  const { asset } = useLoaderData();
  const user = useUserData();
  const hasNotes = asset?.notes.length > 0;

  return (
    <div>
      <NewNote />
      {hasNotes ? (
        <ul className="notes-list mt-8 w-full">
          {asset.notes.map((note: Note) => (
            <li
              key={note.id}
              className="note mb-6 rounded-lg border bg-white md:mb-8"
            >
              <header className="flex justify-between border-b px-3.5 py-3 text-text-xs md:text-text-sm">
                <div>
                  <span className="commentator font-medium text-gray-900">
                    {user?.firstName} {user?.lastName}
                  </span>{" "}
                  <span className="text-gray-600">
                    {timeAgo(note.createdAt)}
                  </span>
                </div>
                <ActionsDopdown note={note} />
              </header>
              <div className="message px-3.5 py-3">
                <MarkdownViewer content={note.content} />
              </div>
            </li>
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
