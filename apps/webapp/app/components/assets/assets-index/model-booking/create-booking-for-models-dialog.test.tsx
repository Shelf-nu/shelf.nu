/**
 * The model-view create-booking dialog's server-error fallback.
 *
 * The endpoint parses one submission with two schemas, so a refusal can name
 * the `models` list rather than any of the booking's own fields. Nothing in the
 * browser produces that message: the dialog's form schema does not describe the
 * models list, so the server is the only thing that can refuse it, and a
 * refusal the dialog does not render leaves the user with a form that looks
 * accepted.
 *
 * Mounted through a stand-in for `BulkUpdateDialogContent`, which is what hands
 * the render callback its fetcher state. Everything the assertions are about is
 * real: pulling the errors out of the response, resolving them into the field
 * map, and the markup that puts them on screen.
 *
 * @see {@link file://./create-booking-for-models-dialog.tsx}
 * @see {@link file://./../../../../routes/api+/bookings.create-for-models.ts}
 */
import type { ReactNode } from "react";
import { OrganizationRoles } from "@prisma/client";
import { act, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { HARDCODED_DEFAULT_PREFS } from "~/utils/date-format";
import { VALIDATION_ERROR } from "~/utils/error";
import CreateBookingForModelsDialog from "./create-booking-for-models-dialog";

/** The fetcher state the stand-in dialog hands the render callback. */
type FetcherState = {
  fetcherData?: Record<string, unknown>;
  fetcherError?: string;
};

const dialogState = vi.hoisted(() => ({
  fetcher: {} as FetcherState,
}));

// why: the real chokepoint renders inside a Radix portal gated on an atom and
// owns the fetcher that posts the form. Standing in for it is how a case states
// the response it is about; the dialog's own render callback stays real.
vi.mock("~/components/bulk-update-dialog/bulk-update-dialog", () => ({
  BulkUpdateDialogContent: ({
    children,
  }: {
    children: (props: {
      disabled: boolean;
      handleCloseDialog: () => void;
      fetcherData?: Record<string, unknown>;
      fetcherError?: string;
    }) => ReactNode;
  }) => (
    <form>
      {children({
        disabled: false,
        handleCloseDialog: () => {},
        ...dialogState.fetcher,
      })}
    </form>
  ),
}));

// why: the dialog reads the asset index loader for the workspace, the custodian
// options and the tag suggestions; a router context would have to serve the
// whole index loader to provide them.
vi.mock("react-router", async () => {
  // why: typed as a plain record rather than the module's own type. A
  // `typeof import(...)` annotation is banned by `consistent-type-imports`,
  // and a namespace import of this module is banned by `no-restricted-imports`
  // (it re-exports `useSearchParams`, which this repo replaces). The spread
  // only needs the real exports to pass through.
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useLoaderData: () => ({
      currentOrganization: {
        id: "org-1",
        selfServiceCanSeeCustody: false,
        selfServiceCanSeeBookings: false,
        baseUserCanSeeCustody: false,
        baseUserCanSeeBookings: false,
      },
      teamMembers: [],
      teamMembersForForm: [],
      tagsData: { tags: [] },
    }),
  };
});

// why: both read route loader data this component test does not mount. Working
// hours off keeps the real booking-form schema focused on the fields under
// test rather than on an opening-times window.
vi.mock("~/hooks/use-working-hours", () => ({
  useWorkingHours: () => ({
    workingHours: null,
    isLoading: false,
    error: undefined,
  }),
}));
vi.mock("~/hooks/use-booking-settings", () => ({
  useBookingSettings: () => ({
    bufferStartTime: 0,
    tagsRequired: false,
    maxBookingLength: null,
    maxBookingLengthSkipClosedDays: false,
  }),
}));
vi.mock("~/hooks/use-format-prefs", () => ({
  useFormatPrefs: () => HARDCODED_DEFAULT_PREFS,
}));
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => [OrganizationRoles.ADMIN],
}));
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => accessFor([OrganizationRoles.ADMIN]),
}));

// why: the date and custodian pickers reach for a calendar, a working-hours
// preview dialog and a network-backed select, none of which carries the models
// message these cases read.
vi.mock("~/components/booking/forms/fields/dates", () => ({
  DatesFields: () => <div data-testid="dates-fields" />,
}));
vi.mock("~/components/booking/forms/fields/custodian", () => ({
  CustodianField: () => <div data-testid="custodian-field" />,
}));
vi.mock("~/components/tag/tags-autocomplete", () => ({
  TagsAutocomplete: () => <div data-testid="tags-autocomplete" />,
}));

/** One selected model, as the model view's bulk selection carries a row. */
const SELECTED_MODEL = {
  id: "am1",
  assetModelId: "am1",
  name: "MacBook Pro 14",
};

/**
 * The response the endpoint returns when the schema refuses the models list.
 *
 * Shaped the way `parseData` and `error()` build it: the refusal names the
 * field under `validationErrors`, and the top-level message repeats the first
 * field message, which is what the dialog's generic fallback would print.
 *
 * @param message - The refusal, as the schema words it
 * @returns The fetcher state for that response
 */
function modelsRefusal(message: string): FetcherState {
  return {
    fetcherError: message,
    fetcherData: {
      error: {
        message,
        label: "Request validation",
        title: "Validation error",
        additionalData: {
          userId: "user-1",
          organizationId: "org-1",
          [VALIDATION_ERROR]: { models: { message } },
        },
      },
    },
  };
}

/**
 * Renders the dialog with one model selected.
 *
 * The selection is seeded AFTER mount: `selectedBulkItemsAtom.onMount` clears
 * it as soon as the first subscriber appears, so anything written to the store
 * beforehand is thrown away by the time the dialog reads it.
 *
 * @returns The testing-library render result
 */
function renderDialog() {
  const store = createStore();

  const result = render(
    <Provider store={store}>
      <CreateBookingForModelsDialog />
    </Provider>
  );

  act(() => {
    store.set(selectedBulkItemsAtom, [SELECTED_MODEL]);
  });

  return result;
}

beforeEach(() => {
  dialogState.fetcher = {};
});

describe("create-booking-for-models dialog", () => {
  it("shows the server's refusal of the models list", () => {
    const message = "Quantity must be a positive integer";
    dialogState.fetcher = modelsRefusal(message);

    renderDialog();

    // getByText throws on more than one match, so this also pins that the
    // generic fallback does not print the same message a second time.
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("keeps a refusal that names no field visible", () => {
    // The workspace guard refuses a foreign model id without naming a form
    // field, so the generic message is the only thing that can carry it.
    const message =
      "Some of the selected models do not exist in your workspace. Please reload and try again.";
    dialogState.fetcher = {
      fetcherError: message,
      fetcherData: {
        error: {
          message,
          label: "Assets",
          title: "Invalid asset models",
          additionalData: { organizationId: "org-1" },
        },
      },
    };

    renderDialog();

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("shows nothing when the submission was not refused", () => {
    renderDialog();

    expect(screen.getByText("MacBook Pro 14")).toBeInTheDocument();
    expect(
      screen.queryByText(/Select at least one model to book/)
    ).not.toBeInTheDocument();
  });
});
