import { useLoaderData } from "@remix-run/react";
import Heading from "~/components/shared/heading";
import SubHeading from "~/components/shared/sub-heading";

import type { HeaderData } from "./types";

export default function Header({
  title = null,
  children,
  subHeading,
}: {
  /** Pass a title to replace the default route title set in the loader
   * This is very useful for interactive adjustments of the title
   */
  title?: string | null;
  children?: React.ReactNode;
  subHeading?: React.ReactNode;
}) {
  const data = useLoaderData();
  const header = data?.header as HeaderData;

  return header ? (
    <header>
      <div className="block sm:flex sm:items-center sm:justify-between">
        <div className="mb-4 sm:mb-0">
          <Heading
            as="h2"
            className="break-all text-display-xs font-semibold md:text-display-sm"
          >
            {title || header?.title}
          </Heading>
          {subHeading ? (
            <SubHeading>{subHeading}</SubHeading>
          ) : (
            header?.subHeading && <SubHeading>{header.subHeading}</SubHeading>
          )}
        </div>

        <div className="flex gap-3">{children}</div>
      </div>
    </header>
  ) : null;
}
