import { useFetcher, useLoaderData } from "@remix-run/react";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { useUserData } from "~/hooks/use-user-data";
import type { loader as locationActivityLoader } from "~/routes/_layout+/locations.$locationId.activity";
import { isFormProcessing } from "~/utils/form";
import { NewLocationNote } from "./new";
import { LocationNoteItem, type LocationNoteWithDate } from "./note";

export const LocationNotes = ({
  canCreate = true,
  canDelete = true,
}: {
  canCreate?: boolean;
  canDelete?: boolean;
} = {}) => {
  const { location, notes } = useLoaderData<typeof locationActivityLoader>();
  const user = useUserData();
  const hasNotes = notes && notes.length > 0;

  const fetcher = useFetcher();
  let optimisticContent = "";

  if (fetcher.formData) {
    const content = fetcher.formData.get("content");
    if (typeof content === "string") {
      optimisticContent = content;
    }
  }

  return (
    <div>
      {canCreate ? <NewLocationNote fetcher={fetcher} /> : null}
      {hasNotes ? (
        <ul className="notes-list mt-8 w-full">
          {canCreate && isFormProcessing(fetcher.state) ? (
            <li className="note mb-2 rounded border bg-white md:mb-8">
              <header className="flex justify-between border-b px-3.5 py-3 text-text-xs md:text-text-sm">
                <div>
                  <span className="commentator font-medium text-gray-900">
                    {user?.firstName} {user?.lastName}
                  </span>{" "}
                  <span className="text-gray-600">Just Now</span>
                </div>
              </header>
              <div className="message px-3.5 py-3">
                <MarkdownViewer content={optimisticContent} />
              </div>
            </li>
          ) : null}
          {(notes as LocationNoteWithDate[]).map((note) => (
            <LocationNoteItem key={note.id} note={note} canDelete={canDelete} />
          ))}
        </ul>
      ) : (
        <div className="flex h-[500px] items-center justify-center">
          <div className="flex flex-col items-center justify-center p-[16px] text-center md:p-[50px]">
            <img
              src="/static/images/no-notes.svg"
              alt="Graphic for no notes"
              className="mb-6 w-[172px]"
            />
            <h4>No Notes</h4>
            <p>
              Your location{" "}
              <span className="font-semibold">{location?.name ?? "—"}</span> has
              no notes
              <br />
              attached to it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
