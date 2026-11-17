/**
 * Unsaved Changes Atoms
 *
 * App-wide view of the forms that `useUnsavedChanges` tracks, for UI that
 * lives outside those forms (such as the reload button of the new-version
 * prompt) and needs to warn before work is lost.
 *
 * @see {@link file://./../hooks/use-unsaved-changes.ts} - keeps the count up to date
 * @see {@link file://./../components/shared/reload-app-button.tsx} - reads it
 */
import { atom } from "jotai";

/**
 * How many mounted forms currently hold unsaved changes. Each dirty form adds
 * one while it is dirty and removes it when it turns clean or unmounts.
 */
export const dirtyFormCountAtom = atom(0);
