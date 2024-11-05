export function markSubstring(string: string) {
  const searchParams = new URLSearchParams(window.location.search);

  let content = <>{string}</>;

  if (searchParams.has("s")) {
    const searchQuery = searchParams.get("s")?.toLowerCase() as string;
    const searchIndex = string.toLowerCase().indexOf(searchQuery);
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
