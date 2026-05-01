import { useMatches } from "react-router";
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
        // `match.id` is the stable Remix route id for this match, which uniquely
        // identifies each breadcrumb entry regardless of position in the chain.
        <Breadcrumb
          key={match.id}
          match={match}
          isLastItem={index === breadcrumbs.length - 1}
        />
      ))}
    </div>
  );
}
