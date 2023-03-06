import { useMatches } from "@remix-run/react";
import { BreadcrumbChevron } from "~/components/icons/library";
import styles from "./styles.module.css";

export default function Breadcrumbs() {
  const matches = useMatches();

  // skip routes that don't have a breadcrumb
  const breadcrumbs = matches.filter(
    (match) => match.handle && match.handle.breadcrumb
  );
  return (
    <header className="mb-5">
      <div className={styles.breadcrumbs}>
        {breadcrumbs.map((match, index) => {
          const isLastItem = index === breadcrumbs.length - 1;
          return (
            <div key={index} className={styles.breadcrumb}>
              {match?.handle?.breadcrumb(match)}{" "}
              {!isLastItem && (
                <span className="mx-4">
                  <BreadcrumbChevron className="inline align-middle" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </header>
  );
}
