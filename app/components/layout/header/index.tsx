import type { ReactNode } from "react";
import type React from "react";
import { useLoaderData } from "react-router";
import Heading from "~/components/shared/heading";
import SubHeading from "~/components/shared/sub-heading";
import { tw } from "~/utils/tw";
import { Breadcrumbs } from "../breadcrumbs";
import { CommandPaletteButton } from "../command-palette";
import type { HeaderData } from "./types";

type SlotKeys = "left-of-title" | "right-of-title" | "append-to-title";

export default function Header({
  title = null,
  children,
  subHeading,
  preHeading,
  hidePageDescription = false,
  hideBreadcrumbs = false,
  classNames,
  slots,
}: {
  /** Pass a title to replace the default route title set in the loader
   * This is very useful for interactive adjustments of the title
   */
  title?: string | ReactNode | null;
  children?: ReactNode;
  subHeading?: ReactNode;
  preHeading?: ReactNode;
  hidePageDescription?: boolean;
  hideBreadcrumbs?: boolean;
  classNames?: string;
  slots?: {
    [key in SlotKeys]?: ReactNode;
  };
}) {
  const data = useLoaderData<{ header?: HeaderData }>();
  const header = data?.header;

  return header ? (
    <header className={tw("-mx-4 bg-white", classNames)}>
      {!hideBreadcrumbs && (
        <>
          <div className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-2 md:min-h-[67px] md:py-3">
            <Breadcrumbs />
            <div className="hidden items-center gap-3 md:flex">
              <CommandPaletteButton className="w-auto md:w-auto" />
              {children ? (
                <div className="flex shrink-0 items-center gap-3">
                  {children}
                </div>
              ) : null}
            </div>
          </div>
          {children && (
            <div className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-2 md:hidden">
              <div className="header-buttons flex flex-1 shrink-0 gap-3">
                {children}
              </div>
            </div>
          )}
        </>
      )}
      {!hidePageDescription && (
        <div className="relative flex items-center border-b border-gray-200 px-4 py-3">
          {slots?.["left-of-title"] ? (
            <div className="relative">{slots["left-of-title"]}</div>
          ) : null}
          <div>
            {preHeading ? (
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {preHeading}
              </div>
            ) : (
              header?.preHeading && (
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {header.preHeading}
                </div>
              )
            )}
            <div className="flex items-center gap-2">
              <Heading as="h2" className="break-all text-[20px] font-semibold">
                {title || header?.title}
              </Heading>
              {slots?.["append-to-title"] || null}
            </div>
            {subHeading ? (
              <SubHeading>{subHeading}</SubHeading>
            ) : (
              header?.subHeading && <SubHeading>{header.subHeading}</SubHeading>
            )}
          </div>
          {slots?.["right-of-title"] || null}
        </div>
      )}
    </header>
  ) : null;
}
