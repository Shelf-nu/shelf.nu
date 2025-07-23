import { ChevronRightIcon } from "@radix-ui/react-icons";
import { useHydrated } from "remix-utils/use-hydrated";
import Icon from "~/components/icons/icon";
import type {
  CommonButtonProps,
  DisabledProp,
} from "~/components/shared/button";
import { Button } from "~/components/shared/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { tw } from "~/utils/tw";
import type { IconType } from "./icons-map";
import When from "../when/when";

type IndexType = "kit" | "asset";

/**
 * Extend CommonButtonProps instead of ButtonProps for the interface
 */
export interface BookLink extends CommonButtonProps {
  indexType: IndexType;
  to: string; // Add required properties from LinkButtonProps
  id: string; // Make id required for BookLink
  icon?: "bookings" | "booking-exist"; // Narrow down the icon types
}
const ConditionalActionsDropdown = ({
  links,
  label,
  disabledTrigger,
}: {
  links: BookLink[];

  label: string;
  disabledTrigger?: DisabledProp;
}) => {
  const {
    ref: dropdownRef,
    open,
    setOpen,
  } = useControlledDropdownMenu({ skipDefault: true });
  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-overlay  transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}
      <DropdownMenu modal={false} open={open}>
        <DropdownMenuTrigger
          className={`asset-actions hidden sm:flex`}
          onClick={() => setOpen(true)}
          asChild
        >
          <Button variant="primary" disabled={disabledTrigger}>
            <span className="flex items-center gap-2">
              {label} <ChevronRightIcon className="chev" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu triggerer on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="primary"
          className="asset-actions sm:hidden"
          onClick={() => {
            setOpen(true);
          }}
          icon="bookings"
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
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-surface p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-surface p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            {links &&
              links.map((link) => (
                <DropdownMenuItem key={link.label} asChild>
                  <Button
                    to={link.to}
                    role="link"
                    variant="link"
                    aria-label={link.label}
                    className="justify-start px-4 py-3  text-color-700 hover:text-color-700"
                    width="full"
                    onClick={() => setOpen(false)}
                    disabled={link.disabled}
                  >
                    <span className="flex items-center gap-2">
                      <When truthy={!!link.icon}>
                        <Icon icon={link.icon as IconType} />
                      </When>
                      {link.label}
                    </span>
                  </Button>
                </DropdownMenuItem>
              ))}
            <DropdownMenuItem className="border-t p-4 md:hidden md:p-0">
              <Button
                role="button"
                variant="secondary"
                className="flex items-center justify-center text-color-700 hover:text-color-700 "
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
/**
 * This is the generic component that is used both on kit and asset page to show the dropdown for Book actions
 */
export const GenericBookActionsDropdown = ({
  links,
  label,
  disabledTrigger,
}: {
  links: BookLink[];
  label: string;
  disabledTrigger?: DisabledProp;
}) => {
  const isHydrated = useHydrated();

  if (!isHydrated)
    return (
      <Button variant="primary" to="#" icon="bookings">
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
        disabledTrigger={disabledTrigger}
      />
    </div>
  );
};
