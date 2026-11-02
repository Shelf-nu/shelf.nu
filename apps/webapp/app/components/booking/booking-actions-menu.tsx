/**
 * The menu every booking surface opens its actions from: the booking page's
 * "Actions" button and the ⋯ icon on a bookings-list row. Callers pass the
 * entries as plain children (action components, a `<Divider />`), in order.
 *
 * Built on the Radix Popover, like `asset-row-actions-dropdown.tsx`: a
 * right-aligned menu under the trigger from `md` up, a bottom sheet with a dim
 * overlay and a Close button below it (see {@link MobileDropdownStyles}).
 *
 * Choosing an entry closes the menu. Most entries open a dialog that is
 * rendered by the entry itself, inside the menu content, so unmounting the
 * content would unmount the dialog with it. The menu therefore holds its
 * content mounted (hidden, `data-state="closed"`) after an entry is chosen, for
 * as long as a dialog that appeared with that choice is still in the document,
 * and then lets it unmount and hands focus back to the trigger. An entry that
 * opens nothing (a link, a direct submit) releases the content after a short
 * grace period.
 *
 * @see {@link file://./actions-dropdown.tsx} the booking page's menu
 * @see {@link file://./asset-row-actions-dropdown.tsx} the Popover pattern
 * @see {@link file://./booking-action-trigger.tsx} the menu rows the entries render
 */
import { forwardRef, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useHydrated } from "remix-utils/use-hydrated";
import { ChevronRight, VerticalDotsIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { MobileDropdownStyles } from "~/components/shared/mobile-dropdown-styles";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { tw } from "~/utils/tw";

/** Trigger look: the page's "Actions ▾" button or the row's ⋯ icon. */
export type BookingActionsMenuTriggerLook = "button" | "icon";

/** Props for {@link BookingActionsMenu}. */
export type BookingActionsMenuProps = {
  /** Trigger look: the page's "Actions ▾" button or the row's ⋯ icon. */
  trigger: BookingActionsMenuTriggerLook;
  /** Menu entries in order. Render a `<Divider />` where a separator belongs. */
  children: ReactNode;
  /** Which edge of the trigger the menu lines up with. Defaults to `"end"`. */
  align?: "start" | "end";
};

/** Everything that counts as an open dialog an entry may have opened. */
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

/**
 * How long a chosen entry has to open its dialog before the menu stops holding
 * its content. React mounts a dialog within the same task as the click, so
 * this only has to outlast that; it is generous so a slow device never loses
 * a dialog.
 */
const NO_DIALOG_GRACE_MS = 300;

/** What an entry's activation is read from: a button or a link in the menu. */
const ENTRY_SELECTOR = "button, a";

/**
 * The dialogs in the document right now.
 *
 * @returns Every element matching {@link DIALOG_SELECTOR}
 */
function dialogsInDocument(): Set<Element> {
  return new Set(document.querySelectorAll(DIALOG_SELECTOR));
}

/**
 * The test id of the booking page's trigger. Set on one element only (the
 * desktop toggle, or the static trigger before hydration), so it selects one.
 */
const BUTTON_TEST_ID: Record<
  BookingActionsMenuTriggerLook,
  string | undefined
> = { button: "bookingActionsButton", icon: undefined };

/** Props for {@link MenuTrigger}. */
type MenuTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Which look to render. */
  look: BookingActionsMenuTriggerLook;
  /** The e2e selector, see {@link BUTTON_TEST_ID}. */
  "data-test-id"?: string;
};

/**
 * The menu's trigger in either look.
 *
 * Forwards its ref and spreads the rest of its props so `PopoverTrigger asChild`
 * can attach its handlers, `aria-expanded` and `data-state` (which turns the
 * chevron through the `asset-actions` class). Also rendered as the static
 * trigger before hydration, so its size never jumps.
 */
const MenuTrigger = forwardRef<HTMLButtonElement, MenuTriggerProps>(
  function MenuTrigger({ look, className, ...props }, ref) {
    if (look === "icon") {
      return (
        <button
          ref={ref}
          type="button"
          aria-label="More actions"
          {...props}
          className={tw(
            "flex items-center justify-center rounded text-gray-600 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-primary-500",
            className
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center"
          >
            <VerticalDotsIcon />
          </span>
        </button>
      );
    }

    return (
      <Button
        ref={ref}
        type="button"
        variant="secondary"
        {...props}
        className={tw("asset-actions flex", className)}
      >
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" aria-hidden="true" />
        </span>
      </Button>
    );
  }
);

/**
 * Renders the trigger and the menu of booking actions.
 *
 * @param props - See {@link BookingActionsMenuProps}
 */
export function BookingActionsMenu({
  trigger,
  children,
  align = "end",
}: BookingActionsMenuProps) {
  /**
   * Static trigger until hydration, so server and client markup agree. Same
   * as `asset-row-actions-dropdown`.
   */
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return (
      <MenuTrigger look={trigger} data-test-id={BUTTON_TEST_ID[trigger]} />
    );
  }

  return (
    <InteractiveBookingActionsMenu trigger={trigger} align={align}>
      {children}
    </InteractiveBookingActionsMenu>
  );
}

/**
 * The hydrated menu. See the file comment for how a chosen entry's dialog
 * outlives the menu closing.
 *
 * @param props - See {@link BookingActionsMenuProps}
 */
function InteractiveBookingActionsMenu({
  trigger,
  children,
  align,
}: BookingActionsMenuProps) {
  /**
   * `skipDefault: true`: a QR scan opens the item's own page menu, never a
   * booking's actions.
   */
  const {
    ref: contentRef,
    open,
    setOpen,
  } = useControlledDropdownMenu({ skipDefault: true });

  /** Whether the content stays mounted while closed, for a chosen entry's dialog. */
  const [held, setHeld] = useState(false);
  /** The dialogs already open when the entry was chosen; they never hold the menu. */
  const dialogsBeforeChoiceRef = useRef<Set<Element>>(new Set());
  /** The element holding the entries; set while the content is mounted. */
  const [entriesElement, setEntriesElement] = useState<HTMLDivElement | null>(
    null
  );
  const desktopTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Closes the menu when an entry is activated (click, or Enter / Space on a
   * focused entry) and starts holding the content for its dialog.
   *
   * A native listener on the entries element, not a React handler: React
   * events from a portalled dialog bubble through the menu's React tree, while
   * native events only see the menu's own DOM, so a click inside a dialog
   * never counts as choosing an entry. A disabled entry (`aria-disabled`, which
   * keeps its reason card working) does not close the menu.
   */
  useEffect(() => {
    if (!entriesElement) return;

    function handleEntryClick(event: MouseEvent) {
      const target = event.target as Element | null;
      const entry = target?.closest(ENTRY_SELECTOR);
      if (!entry || !entriesElement?.contains(entry)) return;
      if (entry.getAttribute("aria-disabled") === "true") return;

      // Taken before React handles the click, so the dialog this entry opens
      // is not in it.
      dialogsBeforeChoiceRef.current = dialogsInDocument();
      setHeld(true);
      setOpen(false);
    }

    entriesElement.addEventListener("click", handleEntryClick);
    return () => entriesElement.removeEventListener("click", handleEntryClick);
  }, [entriesElement, setOpen]);

  /**
   * While held, watches the document for the chosen entry's dialog and
   * releases the content once that dialog has closed. Focus then goes back to
   * the visible trigger if the closing dialog could not return it to the
   * (hidden) entry that opened it.
   *
   * The dialog is not in the document yet when this effect first runs: Radix
   * portals render nothing on their first pass and mount their content from a
   * layout effect, one render later. So the absence of a dialog only releases
   * the content after a grace period ({@link NO_DIALOG_GRACE_MS}), which is
   * how an entry that opens nothing (a link, a direct submit) lets go.
   */
  useEffect(() => {
    if (!held) return;

    /** Whether the chosen entry's dialog has been seen in the document. */
    let sawDialog = false;

    /** Whether a dialog that appeared after the choice is in the document. */
    function hasChosenDialog() {
      const before = dialogsBeforeChoiceRef.current;
      return Array.from(document.querySelectorAll(DIALOG_SELECTOR)).some(
        // The menu's own content is a `role="dialog"` too.
        (dialog) => !before.has(dialog) && !contentRef.current?.contains(dialog)
      );
    }

    function release() {
      setHeld(false);
      const active = document.activeElement;
      if (!active || active === document.body) {
        desktopTriggerRef.current?.focus();
        if (document.activeElement !== desktopTriggerRef.current) {
          mobileTriggerRef.current?.focus();
        }
      }
    }

    function check() {
      if (hasChosenDialog()) {
        sawDialog = true;
      } else if (sawDialog) {
        release();
      }
    }

    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "role"],
    });
    const graceTimer = window.setTimeout(() => {
      if (!sawDialog && !hasChosenDialog()) release();
    }, NO_DIALOG_GRACE_MS);

    return () => {
      observer.disconnect();
      window.clearTimeout(graceTimer);
    };
  }, [held, contentRef]);

  return (
    <>
      {open ? (
        <div className="fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50 transition duration-300 ease-in-out md:hidden" />
      ) : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <MenuTrigger
            ref={desktopTriggerRef}
            look={trigger}
            className="hidden md:flex"
            // One element per id: only the toggling trigger carries it.
            data-test-id={BUTTON_TEST_ID[trigger]}
          />
        </PopoverTrigger>

        {/* Below `md` the trigger only opens, never toggles, so it cannot
            fight the dim overlay; same as the other Popover menus. */}
        <MenuTrigger
          ref={mobileTriggerRef}
          look={trigger}
          className="md:hidden"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        />

        <MobileDropdownStyles open={open} />

        <PopoverPortal forceMount={held ? true : undefined}>
          <PopoverContent
            data-mobile-sheet
            ref={contentRef}
            tabIndex={-1}
            align={align}
            side="bottom"
            sideOffset={4}
            forceMount={held ? true : undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              contentRef.current?.focus();
            }}
            // Held content is closed: hidden, but still mounted for its dialog.
            className="order actions-dropdown static z-[99] !mt-0 w-screen rounded-b-none rounded-t-[4px] border border-gray-300 bg-white p-0 text-right outline-none data-[state=closed]:hidden md:static md:mt-auto md:w-[220px] md:rounded md:shadow-md"
          >
            <div className="order fixed bottom-0 left-0 max-h-[85dvh] w-screen overflow-y-auto rounded-b-none rounded-t-[4px] bg-white p-1.5 text-right md:static md:max-h-none md:w-full md:overflow-visible md:rounded">
              <div ref={setEntriesElement} className="flex flex-col">
                {children}
              </div>

              <div className="border-t p-4 md:hidden">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex items-center justify-center text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={() => setOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}
