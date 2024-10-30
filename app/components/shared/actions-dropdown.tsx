import { ChevronRightIcon } from "@radix-ui/react-icons";
import { useHydrated } from "remix-utils/use-hydrated";
import Icon from "~/components/icons/icon";
import { Button } from "~/components/shared/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import type { IconType } from "~/components/shared/icons-map";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { tw } from "~/utils/tw";

export interface CustomLink {
  role?: string;
  variant?: string;
  label: string;
  to: string;
  indexType: string;
  id: string;
  disabled?: boolean;
  icon: IconType;
  testId: string;
  disabledReason?:
    | boolean
    | {
        title?: string;
        reason: React.ReactNode | string;
      }
    | undefined;
}

const ConditionalActionsDropdown = ({
  links,
  disabledReason,
  label,
  key,
}: {
  links: CustomLink[];
  disabledReason?:
    | boolean
    | { title?: string; reason: React.ReactNode | string };
  label: string;
  key: string;
}) => {
  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

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
          className={`asset-actions hidden sm:flex`}
          onClick={() => setOpen(true)}
          asChild
        >
          <Button
            variant="primary"
            data-test-id={`${key}bookActionsButton`}
            disabled={disabledReason}
            icon="bookings"
          >
            <span className="flex items-center gap-2">
              {label} <ChevronRightIcon className="chev" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu triggerer on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="primary"
          data-test-id={`${key}bookActionsButton`}
          className="asset-actions sm:hidden"
          onClick={() => {
            setOpen(true);
          }}
          icon="bookings"
          disabled={disabledReason}
        >
          <span className="flex items-center gap-2">
            {label} <ChevronRightIcon className="chev" />
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
            {links &&
              links.map((link: CustomLink) => (
                <DropdownMenuItem
                  key={link.label}
                  className={tw("px-4 py-1 md:p-0")}
                  disabled={!!link.disabled}
                >
                  <Button
                    to={link.to}
                    role="link"
                    variant="link"
                    aria-label={link.label}
                    className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                    width="full"
                    onClick={() => setOpen(false)}
                    disabled={link.disabledReason}
                  >
                    <span className="flex items-center gap-2">
                      <Icon icon={link.icon} /> {link.label}
                    </span>
                  </Button>
                </DropdownMenuItem>
              ))}
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

export const ActionsDropDown = ({
  links,
  disabledReason,
  label,
  key,
}: {
  links: CustomLink[];
  disabledReason?:
    | boolean
    | { title?: string; reason: React.ReactNode | string };
  label: string;
  key: string;
}) => {
  const isHydrated = useHydrated();

  if (!isHydrated)
    return (
      <Button
        variant="primary"
        to="#"
        data-test-id={`${key}bookActionsButton`}
        icon="bookings"
      >
        <div className="flex items-center gap-2">
          <span>{label}</span> <ChevronRightIcon className="chev rotate-90" />
        </div>
      </Button>
    );

  return (
    <div className="actions-dropdown flex">
      <ConditionalActionsDropdown
        links={links}
        label={label}
        key={key}
        disabledReason={disabledReason}
      />
    </div>
  );
};
