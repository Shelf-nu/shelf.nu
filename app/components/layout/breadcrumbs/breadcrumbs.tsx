import { useMatches } from "@remix-run/react";
import { Breadcrumb } from "./breadcrumb";

export function Breadcrumbs() {
  const matches = useMatches();

  // skip routes that don't have a breadcrumb
  const breadcrumbs = matches.filter(
    (match) => match.handle && match.handle.breadcrumb
  );
  return (
    <header className="mb-5">
      <div className="breadcrumbs">
        {breadcrumbs.map((match, index) => (
          <Breadcrumb
            key={index}
            match={match}
            isLastItem={index === breadcrumbs.length - 1}
          />
        ))}
      </div>
    </header>
  );
}
