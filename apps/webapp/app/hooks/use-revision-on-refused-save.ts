/**
 * useRevisionOnRefusedSave: a counter that goes up each time a save-on-change
 * fetcher comes back refused (its data carries an `error`).
 *
 * Key the form on it. Its switches are uncontrolled and flip the moment they
 * are clicked, and a Radix switch keeps its visible state in React and
 * ignores a native form reset, so remounting the form from `defaultChecked`
 * is what returns them to the stored value while the error toast explains
 * why.
 *
 * @see {@link file://../components/booking/explicit-requirement-settings-card.tsx}
 * @see {@link file://../components/workspace/managers-can-edit-assets-form.tsx}
 */
import { useEffect, useState } from "react";

/**
 * Returns a revision to key a save-on-change form on.
 *
 * @param fetcher - The fetcher that submits the form
 * @returns A number that changes after every refused save
 */
export function useRevisionOnRefusedSave(fetcher: {
  state: string;
  data: unknown;
}): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refused =
      fetcher.state === "idle" &&
      fetcher.data != null &&
      typeof fetcher.data === "object" &&
      "error" in fetcher.data &&
      Boolean((fetcher.data as { error?: unknown }).error);
    if (refused) setRevision((current) => current + 1);
  }, [fetcher.state, fetcher.data]);

  return revision;
}
