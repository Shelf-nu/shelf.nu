/**
 * This is temp deprecated until we find a better way to implement it.
 */

export function markSubstring(string: string) {
  const searchParams = new URLSearchParams(window.location.search);

  let content = <>{string}</>;

  if (searchParams.has("s")) {
    const searchQuery = searchParams.get("s")?.toLowerCase() as string;
    const searchTerms = searchQuery.split(",").map((term) => term.trim());
    let searchIndex = -1;
    let currentSearchTerm = "";

    for (const term of searchTerms) {
      const index = string.toLowerCase().indexOf(term);
      if (index !== -1 && (searchIndex === -1 || index < searchIndex)) {
        searchIndex = index;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        currentSearchTerm = term;
      }
    }
    if (searchIndex !== -1) {
      const searchLength = searchQuery.length;
      content = (
        <>
          {string.slice(0, searchIndex)}
          <mark>{string.slice(searchIndex, searchIndex + searchLength)}</mark>
          {string.slice(searchIndex + searchLength)}
        </>
      );
    }
  }
  return content;
}
