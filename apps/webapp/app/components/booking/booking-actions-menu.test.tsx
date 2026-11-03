/**
 * Tests for {@link BookingActionsMenu} and the booking page's
 * {@link ActionsDropdown} built on it.
 *
 * The menu: a dialog opened from an entry stays open after the menu closes
 * (the entry's dialog lives inside the menu content), the icon trigger is
 * named for assistive tech, and the menu opens from the keyboard.
 *
 * The page menu: which entries a viewer sees, and in which order, comes from
 * `useBookingActions`. The action components other than Cancel are stubbed
 * there, since each has its own tests; what is asserted is the list of entries.
 *
 * @see {@link file://./booking-actions-menu.tsx}
 * @see {@link file://./actions-dropdown.tsx}
 */
import { forwardRef, useState } from "react";
import type { ReactNode } from "react";
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { ActionsDropdown } from "./actions-dropdown";
import { BookingActionsMenu } from "./booking-actions-menu";
import { CancelBookingDialog } from "./cancel-booking-dialog";

/** The signed-in user. */
const ME = "user-me";

/** The roles the viewer holds; both role hooks below read it. */
let mockRoles: OrganizationRoles[] = [OrganizationRoles.ADMIN];

/** The booking-page loader's answer; tests set it before rendering. */
let mockLoaderData: unknown;

/** A form that takes the ref `useZorm` hands the fetcher form. */
const MockFetcherForm = forwardRef<HTMLFormElement, { children: ReactNode }>(
  ({ children, ...props }, ref) => (
    <form ref={ref} {...props}>
      {children}
    </form>
  )
);
MockFetcherForm.displayName = "MockFetcherForm";

// why: the real `useFetcher`, `fetcher.Form` and `useLoaderData` need a data
// router, which a component test does not mount. The form is a plain form with
// the same props, and the loader answer is set per test.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigation: () => ({ state: "idle" }),
    useLoaderData: () => mockLoaderData,
    useFetcher: () => ({
      state: "idle",
      data: undefined,
      submit: vi.fn(),
      Form: MockFetcherForm,
    }),
  };
});

// why: the app's `useSearchParams` reads the current organization and the
// assets-index loader for its cookie handling; neither is mounted here, and
// these menus read only the URL params, which are empty in these tests.
vi.mock("~/hooks/search-params", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "~/hooks/search-params"
  );
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

// why: the roles come off the `_layout` loader in real code, which is not
// mounted in a render test; drive them per test instead.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => mockRoles,
}));

// why: same loader for the resolved access; derive it from the same roles so
// the grant and the policy cannot disagree.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => accessFor(mockRoles),
}));

// why: the explicit scan switches live on the `_layout` loader; none of the
// page menu's entries read them.
vi.mock("~/hooks/use-booking-settings", () => ({
  useBookingSettings: () => ({
    requireExplicitCheckoutForAdmin: false,
    requireExplicitCheckoutForSelfService: false,
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
  }),
}));

// why: the signed-in user comes off the `_layout` loader too; the custody
// gate compares the booking's custodian with it.
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: ME }),
}));

/** A stand-in entry: a menu row named after the action it replaces. */
function stubEntry(label: string) {
  return function StubEntry() {
    return <button type="button">{label}</button>;
  };
}

// why: the page-menu tests assert which entries show and in which order; each
// action component (its dialog, fetcher and loader reads) has its own tests.
// Cancel stays real: the menu tests open its dialog.
vi.mock("./revert-to-draft-dialog", () => ({
  default: stubEntry("Revert to Draft"),
}));
// why: see the revert-to-draft stub.
vi.mock("./extend-booking-dialog", () => ({ default: stubEntry("Extend") }));
// why: see the revert-to-draft stub.
vi.mock("./archive-booking-action", () => ({
  ArchiveBookingAction: stubEntry("Archive"),
}));
// why: see the revert-to-draft stub.
vi.mock("./duplicate-booking-action", () => ({
  DuplicateBookingAction: stubEntry("Duplicate"),
}));
// why: see the revert-to-draft stub.
vi.mock("./manage-notifications-dialog", () => ({
  default: stubEntry("Manage notifications"),
}));
// why: see the revert-to-draft stub.
vi.mock("./delete-booking", () => ({ DeleteBooking: stubEntry("Delete") }));
// why: see the revert-to-draft stub; the module's helpers stay real.
vi.mock("./booking-overview-pdf", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "./booking-overview-pdf"
  );
  return { ...actual, BookingOverviewPDF: stubEntry("Booking document") };
});
// why: see the revert-to-draft stub; the module's helpers stay real.
vi.mock("./booking-checkin-receipt-pdf", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "./booking-checkin-receipt-pdf"
  );
  return {
    ...actual,
    BookingCheckinReceiptPDF: stubEntry("Check-in receipt"),
  };
});

/**
 * A menu entry that owns a layout `Dialog` (`~/components/layout/dialog`), the
 * way the PDF, revert-to-draft and notification entries do.
 */
function LayoutDialogEntry() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open details
      </button>
      <DialogPortal>
        <Dialog open={open} onClose={() => setOpen(false)} title="Details">
          <button type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        </Dialog>
      </DialogPortal>
    </>
  );
}

/** The desktop (toggling) trigger, which is rendered first. */
function getTrigger(name: string | RegExp) {
  return screen.getAllByRole("button", { name })[0];
}

describe("BookingActionsMenu", () => {
  it("keeps a dialog open after the menu closes", () => {
    render(
      <BookingActionsMenu trigger="button">
        <CancelBookingDialog booking={{ id: "b1", name: "Studio shoot" }} />
      </BookingActionsMenu>
    );

    const trigger = getTrigger(/^Actions/);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    // The menu closed, and the dialog its entry opened is still there.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Cancel Studio shoot")).toBeInTheDocument();
  });

  it("lets the menu content go once the chosen dialog closes", async () => {
    render(
      <BookingActionsMenu trigger="button">
        <CancelBookingDialog booking={{ id: "b1", name: "Studio shoot" }} />
      </BookingActionsMenu>
    );

    const trigger = getTrigger(/^Actions/);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(document.querySelector("[data-mobile-sheet]")).toBeNull();
    });
    // The entry that opened the dialog is gone, so focus returns to the trigger.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("keeps a layout Dialog open after the menu closes, then lets go and reopens fresh", async () => {
    render(
      <BookingActionsMenu trigger="button">
        <LayoutDialogEntry />
      </BookingActionsMenu>
    );

    const trigger = getTrigger(/^Actions/);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Open details" }));

    // The menu closed, and the layout dialog its entry opened is still there.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("dialog[open]")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(document.querySelector("dialog[open]")).toBeNull();
      expect(document.querySelector("[data-mobile-sheet]")).toBeNull();
    });

    // Reopening mounts the menu again, with the dialog closed.
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector("[data-mobile-sheet]")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Open details" })
    ).toBeInTheDocument();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("lets the menu content go when the chosen entry opens no dialog", async () => {
    render(
      <BookingActionsMenu trigger="button">
        <button type="button">Duplicate</button>
      </BookingActionsMenu>
    );

    const trigger = getTrigger(/^Actions/);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(document.querySelector("[data-mobile-sheet]")).toBeNull();
    });
  });

  it("puts the e2e id on one trigger only", () => {
    render(
      <BookingActionsMenu trigger="button">
        <button type="button">Duplicate</button>
      </BookingActionsMenu>
    );

    expect(
      document.querySelectorAll('[data-test-id="bookingActionsButton"]')
    ).toHaveLength(1);
  });

  it("icon trigger has the accessible name More actions", () => {
    render(
      <BookingActionsMenu trigger="icon">
        <button type="button">Duplicate</button>
      </BookingActionsMenu>
    );

    expect(getTrigger("More actions")).toBeInTheDocument();
  });

  it("returns focus to the visible mobile trigger when the sheet is dismissed", async () => {
    const user = userEvent.setup();
    render(
      <BookingActionsMenu trigger="icon">
        <button type="button">Duplicate</button>
      </BookingActionsMenu>
    );

    const [desktopTrigger, mobileTrigger] = screen.getAllByRole("button", {
      name: "More actions",
    });
    // why: happy-dom applies no CSS, so `hidden md:flex` never hides the
    // desktop trigger; reporting no boxes is how a browser shows display:none.
    vi.spyOn(desktopTrigger, "getClientRects").mockReturnValue(
      [] as unknown as DOMRectList
    );

    mobileTrigger.focus();
    await user.click(mobileTrigger);
    expect(mobileTrigger).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");

    expect(mobileTrigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(document.activeElement).toBe(mobileTrigger);
    });
  });

  it("opens with keyboard Enter", async () => {
    const user = userEvent.setup();
    render(
      <BookingActionsMenu trigger="icon">
        <button type="button">Duplicate</button>
      </BookingActionsMenu>
    );

    const trigger = getTrigger("More actions");
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Duplicate" })
    ).toBeInTheDocument();
  });
});

/** A booking-page loader answer for one booking held by the viewer. */
function pageLoaderData(
  status: BookingStatus,
  custody: { custodianUserId: string | null } = { custodianUserId: ME }
) {
  return {
    booking: {
      id: "b1",
      name: "Studio shoot",
      status,
      from: new Date("2026-11-01T09:00:00Z"),
      to: new Date("2026-11-30T17:00:00Z"),
      ...custody,
      custodianTeamMember: { userId: ME },
      bookingAssets: [],
      modelRequests: [],
    },
    hasDispositionedUnits: false,
    nextReservations: [],
  };
}

/** Opens the page menu and returns its entries' labels, in order. */
function openPageMenu(): string[] {
  render(<ActionsDropdown />);
  fireEvent.click(getTrigger(/^Actions/));
  const content = document.querySelector<HTMLElement>("[data-mobile-sheet]");
  if (!content) throw new Error("The menu did not open");
  return (
    within(content)
      .getAllByRole("button")
      .map((entry) => entry.textContent?.trim() ?? "")
      // The sheet's own Close button is not an entry.
      .filter((label) => label !== "Close")
  );
}

describe("ActionsDropdown (booking page)", () => {
  beforeEach(() => {
    mockRoles = [OrganizationRoles.ADMIN];
  });

  it("shows today's items for an ONGOING booking held by the viewer", () => {
    mockLoaderData = pageLoaderData(BookingStatus.ONGOING);

    expect(openPageMenu()).toEqual([
      "Cancel",
      "Extend",
      "Duplicate",
      "Manage notifications",
      "Delete",
      "Booking document",
      "Check-in receipt",
    ]);
  });

  it("shows no Delete for a Self Service viewer on a non-draft", () => {
    mockRoles = [OrganizationRoles.SELF_SERVICE];
    mockLoaderData = pageLoaderData(BookingStatus.ONGOING);

    const entries = openPageMenu();
    expect(entries).not.toContain("Delete");
    expect(entries).toContain("Duplicate");
  });

  it("hides the documents from a Self Service viewer who is not the booking's custodian user", () => {
    // Held through the team-member link only: the server refuses this viewer
    // the documents, so the menu does not offer them.
    mockRoles = [OrganizationRoles.SELF_SERVICE];
    mockLoaderData = pageLoaderData(BookingStatus.ONGOING, {
      custodianUserId: null,
    });

    const entries = openPageMenu();
    expect(entries).toContain("Duplicate");
    expect(entries).not.toContain("Booking document");
    expect(entries).not.toContain("Check-in receipt");
  });
});
