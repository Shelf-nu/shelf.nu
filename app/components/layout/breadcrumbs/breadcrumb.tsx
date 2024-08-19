import type { UIMatch } from "@remix-run/react";
import { ChevronRight } from "~/components/icons/library";

export function Breadcrumb({
  match,
  isLastItem,
}: {
  match: UIMatch<any, any>;
  isLastItem: boolean;
}) {
  let breadcrumb = match?.handle?.breadcrumb(match);
  /**
   * If the value is "single" that means we have to
   * take the page title and render it.
   * This takes care of showing the correct title in asset show page*/
  if (typeof breadcrumb === "string") {
    if (breadcrumb === "single") {
      if (match?.data?.location) {
        breadcrumb =
          <span className="single-crumb">{match?.data?.location?.name}</span> ||
          "Not found";
      } else if (match?.data?.organization) {
        breadcrumb =
          (
            <span className="single-crumb">
              {match?.data?.organization?.name}
            </span>
          ) || "Not found";
      } else if (match?.data?.booking) {
        breadcrumb =
          <span className="single-crumb">{match?.data?.booking?.name}</span> ||
          "Not found";
      } else if (match?.data?.kit) {
        breadcrumb =
          <span className="single-crumb">{match?.data?.kit?.name}</span> ||
          "Not found";
      } else if (match?.data?.userName) {
        breadcrumb =
          <span className="single-crumb">{match?.data?.userName}</span> ||
          "Not found";
      } else {
        breadcrumb =
          <span className="single-crumb">{match?.data?.asset?.title}</span> ||
          "Not found";
      }
    } else {
      breadcrumb =
        <span className="single-crumb">{breadcrumb}</span> || "Not found";
    }
  }

  return breadcrumb ? (
    <div className="breadcrumb">
      {breadcrumb}{" "}
      {!isLastItem && (
        <span className="mx-2.5 md:mx-4">
          <ChevronRight className="inline align-middle" />
        </span>
      )}
    </div>
  ) : null;
}
