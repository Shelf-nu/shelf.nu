import { useLoaderData, useFetcher } from "@remix-run/react";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { useUserData } from "~/hooks";
import { isFormProcessing } from "~/utils";
import { NewNote } from "./new";
import type { NoteWithDate } from "./note";
import { Note } from "./note";

export const Notes = () => {
  const { asset } = useLoaderData();
  const user = useUserData();
  const hasNotes = asset?.notes.length > 0;
  const fetcher = useFetcher();
  let onSubmissionContent = "";
  if (fetcher.formData) {
    for (const data of fetcher.formData.entries()) {
      onSubmissionContent = data[1].toString();
    }
  }
  return (
    <div>
      <div>{JSON.stringify(fetcher)}</div>
      <NewNote fetcher={fetcher} />
      {hasNotes ? (
        <ul className="notes-list mt-8 w-full">
          {isFormProcessing(fetcher.state) ? (
            <li className="note mb-6 rounded-lg border bg-white md:mb-8">
              <header className="flex justify-between border-b px-3.5 py-3 text-text-xs md:text-text-sm">
                <div>
                  <span className="commentator font-medium text-gray-900">
                    {user?.firstName} {user?.lastName}
                  </span>{" "}
                  <span className="text-gray-600">Just Now</span>
                </div>
              </header>
              <div className="message px-3.5 py-3">
                <MarkdownViewer content={onSubmissionContent} />
              </div>
            </li>
          ) : null}
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
