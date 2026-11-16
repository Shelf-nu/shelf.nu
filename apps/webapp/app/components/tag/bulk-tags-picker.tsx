/**
 * Tag picker for the bulk "Assign tags" and "Remove tags" dialogs.
 *
 * Owns its `useTagSuggestions` search, so the search lives exactly as long as
 * the picker is mounted. Render it inside the dialog's content: the dialog
 * unmounts its content when it closes, which drops the typed search, its
 * results and its error, and cancels a pending search. Each opening starts
 * from the first page.
 *
 * @see {@link file://./use-tag-suggestions.ts}
 * @see {@link file://../assets/bulk-assign-tags-dialog.tsx}
 * @see {@link file://../assets/bulk-remove-tags-dialog.tsx}
 */
import type { TagUseFor } from "@prisma/client";
import { TagsAutocomplete } from "./tags-autocomplete";
import { TAG_SEARCHING_TEXT, useTagSuggestions } from "./use-tag-suggestions";

/**
 * Searchable tag picker with the search's error shown under it.
 *
 * @param useFor - Only offer tags usable for this entity (plus tags usable for
 *   all entities). Omit to offer every tag.
 */
export function BulkTagsPicker({ useFor }: { useFor?: TagUseFor }) {
  const { suggestions, onInputChange, isSearching, error } = useTagSuggestions({
    useFor,
  });

  return (
    <>
      <TagsAutocomplete
        existingTags={[]}
        suggestions={suggestions}
        onInputChange={onInputChange}
        noOptionsText={isSearching ? TAG_SEARCHING_TEXT : undefined}
      />

      {error && <p className="text-sm text-error-500">{error}</p>}
    </>
  );
}
