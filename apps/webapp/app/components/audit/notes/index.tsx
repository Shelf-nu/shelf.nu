import { useFetcher, useLoaderData } from "react-router";
import { Note, type NoteWithUser } from "~/components/assets/notes/note";
import { Button } from "~/components/shared/button";
import { useUserData } from "~/hooks/use-user-data";
import type { loader } from "~/routes/_layout+/audits.$auditId.activity";
import { isFormProcessing } from "~/utils/form";
import { ActionsDropdown } from "./actions-dropdown";
import { NewNote } from "./new";

export const AuditNotes = () => {
  const { session } = useLoaderData<typeof loader>();

  /* Using user data here for the Note component generated for frontend only as per the optimistic UI approach */
  const user = useUserData();

  const hasNotes = session?.notes && session?.notes.length > 0;

  // Construct base URL for asset links
  const assetLinkBase = `/audits/${session.id}/scan`;

  /* Importing fetcher here in the parent file such that we can use fetcher's states to know the status of form processing and form data render the frontend component on the fly (Optimistic UI) and in the new note form this fetcher is passed as a prop */
  const fetcher = useFetcher({ key: "add-audit-note" });
  let onSubmissionContent = "";
  /* Getting the form data using fetcher and storing the content of form in onSubmissionContent Variable */
  if (fetcher.formData) {
    for (const data of fetcher.formData.entries()) {
      onSubmissionContent = data[1].toString();
    }
  }

  // Create optimistic note data that matches the NoteWithUser shape
  const optimisticNote: NoteWithUser | null =
    isFormProcessing(fetcher.state) && onSubmissionContent
      ? {
          id: "optimistic-note", // Temporary ID for optimistic UI
          content: onSubmissionContent,
          type: "COMMENT",
          createdAt: new Date().toISOString(),
          user: user
            ? {
                firstName: user.firstName || "",
                lastName: user.lastName || "",
              }
            : undefined,
        }
      : null;

  return (
    <div className="relative">
      {hasNotes ? (
        <Button
          to={`/audits/${session.id}/activity.csv`}
          variant="secondary"
          className={
            "absolute right-0 top-[-58px] hidden px-2 py-1 text-sm md:inline-flex"
          }
          download
          reloadDocument
        >
          Export activity CSV
        </Button>
      ) : null}
      <NewNote fetcher={fetcher} />
      {hasNotes ? (
        <ul className="notes-list mt-8 w-full">
          {/* Render optimistic note using the same Note component */}
          {optimisticNote && (
            <Note
              key={optimisticNote.id}
              note={optimisticNote}
              actionsDropdown={<ActionsDropdown noteId={optimisticNote.id} />}
              assetLinkBase={assetLinkBase}
            />
          )}
          {/* Render all existing notes */}
          {(session.notes as NoteWithUser[]).map((note) => (
            <Note
              key={note.id}
              note={note}
              actionsDropdown={<ActionsDropdown noteId={note.id} />}
              assetLinkBase={assetLinkBase}
            />
          ))}
        </ul>
      ) : (
        <div className="flex h-[500px] items-center  justify-center">
          <div className="flex flex-col items-center justify-center p-[16px] text-center md:p-[50px]">
            <img
              src="/static/images/no-notes.svg"
              alt="Graphic for no notes"
              className="mb-6 w-[172px]"
            />
            <h4>No Activity</h4>
            <p>
              Your audit `{session?.name}` has no activity <br />
              recorded yet.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
