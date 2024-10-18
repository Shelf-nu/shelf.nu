import { useHydrated } from "remix-utils/use-hydrated";
import Icon from "~/components/icons/icon";
import { ChevronRight } from "~/components/icons/library";
import { Button } from "~/components/shared/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import type { IconType } from "~/components/shared/icons-map";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { tw } from "./tw";


export interface Link {
    role?: string;
    variant?:string;
    label: string;
    to: string;
    indexType: string;
    id: string
    disabled?: boolean;
    icon: IconType;
    testId: string
    disabled_reason: boolean | {
        title?: string;
        reason: React.ReactNode | string;
    } | undefined;
}

const ConditionalBookActionsDropdown = ({links, indexType}:{links:Link[], indexType:string}) => {
  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  const disabled_reason = links.find((link) => link.disabled)?.disabled_reason

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50  transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (defaultApplied && window.innerWidth <= 640) setOpen(open);
        }}
        open={open}
        defaultOpen={defaultOpen}
      >
        <DropdownMenuTrigger
          className={`${indexType}-actions hidden sm:flex`}
          onClick={() => setOpen(true)}
          asChild
        >
          <Button variant="primary" data-test-id={`${indexType}bookActionsButton`} disabled={disabled_reason}>
            <span className="flex items-center gap-2">
              Book {indexType} <ChevronRight className="chev" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu triggerer on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="primary"
          data-test-id={`${indexType}bookActionsButton`}
          className="asset-actions sm:hidden"
          onClick={() =>{setOpen(true)}}
          disabled={disabled_reason}
        >
          <span className="flex items-center gap-2">
            Book {indexType} <ChevronRight className="chev" />
          </span>
        </Button>

        {open && (
          <style
            dangerouslySetInnerHTML={{
              __html: `@media (max-width: 640px) {
                [data-radix-popper-content-wrapper] {
                  transform: none !important;
                  will-change: auto !important;
                }
              }`,
            }} // is a hack to fix the dropdown menu not being in the right place on mobile
            // can not target [data-radix-popper-content-wrapper] for this file only with css
            // so we have to use dangerouslySetInnerHTML
            // PR : https://github.com/Shelf-nu/shelf.nu/pull/304
          ></style>
        )}
        <DropdownMenuContent
          asChild
          align="end"
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            {links && links.map((link: Link)=><DropdownMenuItem key={link.label}
                className={tw("px-4 py-1 md:p-0")}
                disabled={!!link.disabled}
              >
                <Button
                  to={link.to}
                  role="link"
                  variant="link"
                  aria-label={link.label}
                  className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                  prefetch="none"
                  width="full"
                  onClick={()=>setOpen(false)}
                  disabled={link.disabled_reason}
                >
                  <span className="flex items-center gap-2">
                    <Icon icon={link.icon} /> {link.label}
                  </span>
                </Button>
              </DropdownMenuItem>)}
            <DropdownMenuItem className="border-t p-4 md:hidden md:p-0">
              <Button
                role="button"
                variant="secondary"
                className="flex items-center justify-center text-gray-700 hover:text-gray-700 "
                width="full"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};


export const BookActionsDropDown = ({links, indexType}:{links:Link[], indexType:string}) => {
  const isHydrated = useHydrated();

  if (!isHydrated)
    return (
      <Button variant="primary" to="#" data-test-id={`${indexType}bookActionsButton`}>
        <div className="flex items-center gap-2">
          <span>Book {indexType}</span> <ChevronRight className="chev rotate-90" />
        </div>
      </Button>
    );
  

  return (
    <div className="actions-dropdown flex">
      <ConditionalBookActionsDropdown links= {links} indexType={indexType}/>
    </div>
  );
};

