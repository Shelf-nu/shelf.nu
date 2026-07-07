/**
 * Asset activity log UI.
 *
 * Renders an asset's notes (the "Activity" tab) using the shared list toolbar
 * (`Filters` + `StatusFilter` + `Pagination`, with `SearchForm` built into
 * `Filters`) so the stream can be filtered by type, searched, and paginated
 * like every other list in the app. Reads the paginated list-response shape
 * from the activity route loader; notes render as cards via the shared `Note`.
 *
 * @see {@link file://./../../../routes/_layout+/assets.$assetId.activity.tsx} loader
 * @see {@link file://./../../../modules/note/service.server.ts} getPaginatedAndFilterableAssetNotes
 */
import { useFetcher, useLoaderData } from "react-router";
import { StatusFilter } from "~/components/booking/status-filter";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Pagination } from "~/components/list/pagination";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { useUserData } from "~/hooks/use-user-data";
import { NOTE_TYPE_FILTER_ITEMS } from "~/modules/note/note-filters";
import type { loader } from "~/routes/_layout+/assets.$assetId.activity";
import { isFormProcessing } from "~/utils/form";
import { ActionsDropdown } from "./actions-dropdown";
import { NewNote } from "./new";
import type { NoteWithUser } from "./note";
import { Note } from "./note";

/**
 * The asset activity log.
 *
 * Reuses the shared list toolbar (`Filters` + `StatusFilter` + `Pagination`)
 * so the activity stream can be searched, filtered by type, and paginated like
 * every other list in the app. Notes are rendered as cards (not table rows),
 * so this composes the toolbar primitives directly rather than via `<List>`.
 */
export const Notes = () => {
  const { asset, items, search, hasNotes, page } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  /* Using user data here for the Note component generated for frontend only as per the optimistic UI approach */
  const user = useUserData();

  const notes = items as NoteWithUser[];

  /** Whether a search term or note-type filter is currently narrowing the list */
  const noteTypeFilter = searchParams.get("noteType");
  const hasActiveFilters =
    !!search || (!!noteTypeFilter && noteTypeFilter !== "ALL");

  /* Importing fetcher here in the parent file such that we can use fetcher's states to know the status of form processing and form data render the frontend component on the fly (Optimistic UI) and in the new note form this fetcher is passed as a prop */
  const fetcher = useFetcher({ key: "add-note" });
  let onSubmissionContent = "";
  /* Getting the form data using fetcher and storing the content of form in onSubmissionContent Variable */
  if (fetcher.formData) {
    for (const data of fetcher.formData.entries()) {
      onSubmissionContent = data[1].toString();
    }
  }

  /**
   * A new note is always a COMMENT and, because comments are ordered
   * newest-first and are unfiltered by search/page, it lands on page 1. So the
   * optimistic placeholder is only shown when it would actually appear in the
   * current view: a comments-inclusive filter (not "Updates"), no active search
   * term, and page 1. Showing it in any other view would make it flash in and
   * then disappear on revalidation, once the real (absent-from-this-view) list
   * comes back from the server.
   */
  const filterIncludesComments =
    noteTypeFilter !== NOTE_TYPE_FILTER_ITEMS.Updates;
  const optimisticNote: NoteWithUser | null =
    filterIncludesComments &&
    !search &&
    page === 1 &&
    isFormProcessing(fetcher.state) &&
    onSubmissionContent
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

  const hasResults = notes.length > 0 || !!optimisticNote;

  return (
    <ListContentWrapper>
      <Filters
        slots={{
          "left-of-search": (
            <StatusFilter
              name="noteType"
              statusItems={NOTE_TYPE_FILTER_ITEMS}
            />
          ),
        }}
      >
        {hasNotes ? (
          <Button
            to={`/assets/${asset.id}/activity.csv`}
            variant="secondary"
            className="mt-2 w-full px-3.5 py-2 text-sm md:mt-0 md:w-max"
            download
            reloadDocument
          >
            Export activity CSV
          </Button>
        ) : null}
      </Filters>

      <NewNote fetcher={fetcher} />

      {hasResults ? (
        <>
          <ul className="notes-list mt-8 w-full">
            {/* Render optimistic note using the same Note component */}
            {optimisticNote && (
              <Note
                key={optimisticNote.id}
                note={optimisticNote}
                actionsDropdown={<ActionsDropdown noteId={optimisticNote.id} />}
              />
            )}
            {/* Render the current page of notes */}
            {notes.map((note) => (
              <Note
                key={note.id}
                note={note}
                actionsDropdown={<ActionsDropdown noteId={note.id} />}
              />
            ))}
          </ul>
          <Pagination />
        </>
      ) : hasActiveFilters ? (
        <div className="flex h-[300px] items-center justify-center">
          <div className="flex flex-col items-center justify-center p-[16px] text-center md:p-[50px]">
            <h4>No matching activity</h4>
            <p>
              No notes match your current search or filter. <br />
              Try adjusting them to see more.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex h-[500px] items-center  justify-center">
          <div className="flex flex-col items-center justify-center p-[16px] text-center md:p-[50px]">
            <img
              src="/static/images/no-notes.svg"
              alt="Graphic for no notes"
              className="mb-6 w-[172px]"
            />
            <h4>No Notes</h4>
            <p>
              Your asset `{asset?.title}` has no notes <br />
              attached to it.
            </p>
          </div>
        </div>
      )}
    </ListContentWrapper>
  );
};
