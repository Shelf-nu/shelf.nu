import { ChevronRight } from "~/components/icons/library";

export function Breadcrumb({
  match,
  isLastItem,
}: {
  match: {
    handle: {
      breadcrumb: (match: {
        data: { location: { name: string } } | { asset: { title: string } };
      }) => string;
    };
  };
  isLastItem: boolean;
}) {
  let breadcrumb = match?.handle?.breadcrumb(match);
  /**
   * If the value is "single" that means we have to
   * take the page title and render it.
   * This takes care of showing the correct title in asset show page*/
  if (typeof breadcrumb === "string" && breadcrumb === "single") {
    if (match?.data?.location) {
      breadcrumb = match?.data?.location?.name || "Not found";
    } else {
      breadcrumb = match?.data?.asset?.title || "Not found";
    }
  }

  return breadcrumb ? (
    <div className="breadcrumb">
      {breadcrumb}{" "}
      {!isLastItem && (
        <span className="mx-4">
          <ChevronRight className="inline align-middle" />
        </span>
      )}
    </div>
  ) : null;
}
