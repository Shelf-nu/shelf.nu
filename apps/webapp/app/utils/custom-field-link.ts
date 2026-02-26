export function buildCustomFieldLinkHref(rawValue: string) {
  try {
    const url = new URL(rawValue);

    const hasShelfRef = url.searchParams
      .getAll("ref")
      .some((value) => value === "shelf-webapp");

    if (!hasShelfRef) {
      url.searchParams.append("ref", "shelf-webapp");
    }

    return url.toString();
  } catch (_error) {
    const [withoutHash, hashFragment] = rawValue.split("#");
    const [base, queryString] = withoutHash.split("?");
    const params = new URLSearchParams(queryString);
    const hasShelfRef = params
      .getAll("ref")
      .some((value) => value === "shelf-webapp");

    if (!hasShelfRef) {
      params.append("ref", "shelf-webapp");
    }

    const search = params.toString();
    const rebuilt = search ? `${base}?${search}` : `${base}?ref=shelf-webapp`;

    return hashFragment ? `${rebuilt}#${hashFragment}` : rebuilt;
  }
}
