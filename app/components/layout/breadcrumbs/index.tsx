import { useMatches } from "@remix-run/react";
import { Breadcrumb } from "./breadcrumb";

// Define an interface that extends RouteHandle with the 'breadcrumb' property
interface HandleWithBreadcrumb {
  breadcrumb?: any; // Change 'any' to the actual type of 'breadcrumb' if known
}

export function Breadcrumbs() {
  const matches = useMatches();

  // Filter matches to include only those with 'breadcrumb' property
  const breadcrumbs = matches.filter(
    (match) => (match.handle as HandleWithBreadcrumb)?.breadcrumb !== undefined
  );

  return (
    <div className="breadcrumbs">
      {breadcrumbs.map((match, index) => (
        <Breadcrumb
          key={index}
          match={match}
          isLastItem={index === breadcrumbs.length - 1}
        />
      ))}
    </div>
  );
}
