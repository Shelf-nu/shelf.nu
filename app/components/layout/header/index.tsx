import { useLoaderData } from "@remix-run/react";
import Heading from "~/components/shared/heading";
import SubHeading from "~/components/shared/sub-heading";

import type { HeaderData } from "./types";

export default function Header({
  title = null,
  children,
}: {
  /** Pass a title to replace the default route title set in the loader
   * This is very useful for interactive adjustments of the title
   */
  title?: string | null;
  children?: React.ReactNode;
}) {
  const data = useLoaderData();
  const header = data?.header as HeaderData;

  return (
    <header>
      <div className="flex justify-between">
        <div>
          <Heading as="h2" className="text-display-sm font-semibold">
            {title || header?.title}
          </Heading>
          {header?.subHeading && <SubHeading>{header.subHeading}</SubHeading>}
        </div>

        <div className="flex gap-3">{children}</div>
      </div>
    </header>
  );
}
