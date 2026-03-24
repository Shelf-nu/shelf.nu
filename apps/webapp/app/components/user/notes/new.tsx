/**
 * New User Note Form
 *
 * Wraps the shared MarkdownNoteForm component with the correct action URL
 * for creating notes on user profiles. The form submits to the note action route.
 *
 * Uses a Jotai atom to persist the editing state (expanded/collapsed)
 * across re-renders.
 *
 * NOTE: This UI component lives under `user/notes/` for the user-facing context,
 * but the data layer uses the `TeamMemberNote` model for workspace-scoped storage.
 *
 * @see {@link file://./../../notes/markdown-note-form.tsx} for the shared form component
 * @see {@link file://./../../../modules/team-member-note/service.server.ts} for the data layer
 */
import { atom } from "jotai";
import type { FetcherWithComponents } from "react-router";
import { useParams } from "react-router";
import { MarkdownNoteForm } from "~/components/notes/markdown-note-form";

/** Jotai atom to track whether the note editor is expanded */
const isEditingAtom = atom(false);

/**
 * Renders the markdown note creation form for user notes.
 *
 * @param props.fetcher - The React Router fetcher instance from the parent container,
 *   used for optimistic UI coordination
 */
export const NewUserNote = ({
  fetcher,
}: {
  fetcher: FetcherWithComponents<any>;
}) => {
  const params = useParams();

  return (
    <MarkdownNoteForm
      fetcher={fetcher}
      action={`/settings/team/users/${params.userId}/note`}
      formId="NewUserNoteForm"
      editingAtom={isEditingAtom}
    />
  );
};
