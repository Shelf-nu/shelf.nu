import { useCallback, useEffect } from "react";
import { useSearchParams } from "./search-params";

/**
 * Custom hook to manage text fragments in the URL.
 */
export function useTextFragment() {
  const [searchParams] = useSearchParams();
  /**
   * Adds a text fragment to the URL hash if it doesn't already exist.
   * @param text - The text to add as a fragment.
   */
  const addTextFragment = useCallback((text: string) => {
    // Create a new URL object from the current location
    const url = new URL(window.location.href);

    // Check if a text fragment is already in the hash
    if (!url.hash.includes(":~:text=")) {
      // Append the new text fragment in the proper format
      url.hash += `:~:text=${encodeURIComponent(text)}`;

      // Update the URL without refreshing the page
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  /**
   * Updates the existing text fragment in the URL, or adds it if none exists.
   * @param newText - The new text to replace the existing fragment.
   */
  const updateTextFragment = useCallback((newText: string) => {
    const url = new URL(window.location.href);

    // Check if the URL hash includes a text fragment
    if (url.hash.includes(":~:text=")) {
      // Replace the existing text fragment with the new text
      url.hash = url.hash.replace(
        /:~:text=[^&]*/,
        `:~:text=${encodeURIComponent(newText)}`
      );
    } else {
      // If no fragment exists, add the new text fragment
      url.hash += `:~:text=${encodeURIComponent(newText)}`;
    }

    // Update the URL without a page reload
    window.history.replaceState(null, "", url.toString());
  }, []);

  /**
   * Removes the text fragment from the URL, if it exists.
   */
  const removeTextFragment = useCallback(() => {
    const url = new URL(window.location.href);

    // Check if the URL contains a text fragment and remove it
    if (url.hash.includes(":~:text=")) {
      url.hash = url.hash.replace(/:~:text=[^&]*/, "");

      // Update the URL to remove the fragment
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  /**
   * Adds text fragment when search gets updated
   */

  useEffect(() => {
    const search = searchParams.get("s");

    if (search) {
      addTextFragment(search);
    } else {
      removeTextFragment();
    }
  }, [addTextFragment, removeTextFragment, searchParams]);

  // Return the three methods for managing text fragments in the URL
  return { addTextFragment, updateTextFragment, removeTextFragment };
}
