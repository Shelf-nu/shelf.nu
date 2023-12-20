import { useLoaderData } from "@remix-run/react";
import Heading from "~/components/shared/heading";
import SubHeading from "~/components/shared/sub-heading";

import type { HeaderData } from "./types";
import { Breadcrumbs } from "../breadcrumbs";

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
  const data = useLoaderData<{
    header?: HeaderData;
  }>();
  const header = data?.header;

  return header ? (
    <header className="-mx-4">
      <div className="block">
        <div className="mb-4 sm:mb-0">
          <div className="flex w-full items-center justify-between border-b border-gray-200 px-4 pb-2 md:pb-3">
            <Breadcrumbs />
            <div className="hidden shrink-0 gap-3 md:flex">{children}</div>
          </div>
          <div className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-2 md:hidden">
            <div className="flex shrink-0 gap-3">{children}</div>
          </div>
          <div className="border-b border-gray-200 p-4 ">
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
        </div>
      </div>
    </header>
  ) : null;
}
