import { useLoaderData } from "@remix-run/react";
import Heading from "~/components/shared/heading";
import SubHeading from "~/components/shared/sub-heading";

import type { HeaderData } from "./types";
import { Breadcrumbs } from "../breadcrumbs";

export default function Header({
  title = null,
  children,
  subHeading,
  hidePageDescription = false,
}: {
  /** Pass a title to replace the default route title set in the loader
   * This is very useful for interactive adjustments of the title
   */
  title?: string | null;
  children?: React.ReactNode;
  subHeading?: React.ReactNode;
  hidePageDescription?: boolean;
}) {
  const data = useLoaderData<{
    header?: HeaderData;
  }>();
  const header = data?.header;

  return header ? (
    <header className="-mx-4 bg-white">
      <div className="mb-4">
        <div className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-2 md:py-3">
          <Breadcrumbs />
          <div className="hidden shrink-0 gap-3 md:flex">{children}</div>
        </div>
        <div className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-2 md:hidden">
          <div className="flex shrink-0 gap-3">{children}</div>
        </div>
        {!hidePageDescription && (
          <div className="border-b border-gray-200 p-4">
            <Heading as="h2" className="break-all text-[20px] font-semibold">
              {title || header?.title}
            </Heading>
            {subHeading ? (
              <SubHeading>{subHeading}</SubHeading>
            ) : (
              header?.subHeading && <SubHeading>{header.subHeading}</SubHeading>
            )}
          </div>
        )}
      </div>
    </header>
  ) : null;
}
