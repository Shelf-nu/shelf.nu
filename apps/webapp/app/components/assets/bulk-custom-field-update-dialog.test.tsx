/**
 * Bulk "Set custom field" dialog: the consumer side of the wire contract.
 *
 * The dialog reads `GET /api/assets/bulk-update-custom-field` through
 * `useApiQuery`, a cast with no runtime check. The route test pins what the
 * route sends; these tests feed the dialog that same `{ customFields }` shape
 * and read the real form it renders, so a renamed key, or a value posted in a
 * spelling the server does not accept, fails here.
 *
 * @see {@link file://./bulk-custom-field-update-dialog.tsx}
 * @see {@link file://./../../../test/routes-tests/api.assets.bulk-update-custom-field.test.ts}
 */
import type { ReactNode } from "react";
import { fireEvent, render } from "@testing-library/react";
import type * as Jotai from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import type { BulkSettableCustomField } from "~/modules/asset/bulk-custom-field.server";
import BulkCustomFieldUpdateDialog from "./bulk-custom-field-update-dialog";

/** Per-atom overrides consulted by the mocked `useAtomValue`. */
const atomValues = new Map<unknown, unknown>();

/** What the mocked `useApiQuery` returns: the route's payload. */
const apiResponse: { data: { customFields: BulkSettableCustomField[] } } = {
  data: { customFields: [] },
};

// why: the selection atom resets itself on mount; overriding per-atom lets the
// test open the dialog with a selection while other atoms resolve normally.
vi.mock("jotai", async () => {
  const actual = await vi.importActual<typeof Jotai>("jotai");
  return {
    ...actual,
    useAtomValue: (anAtom: unknown) =>
      atomValues.has(anAtom)
        ? atomValues.get(anAtom)
        : actual.useAtomValue(
            anAtom as Parameters<typeof actual.useAtomValue>[0]
          ),
    useSetAtom: () => () => {},
  };
});

// why: the network read is the boundary under test; the fixture stands in for
// the route's response, in the shape the route test pins.
vi.mock("~/hooks/use-api-query", () => ({
  default: () => ({ ...apiResponse, isLoading: false }),
}));

// why: `useFetcherWithReset` needs a data router. A plain `<form>` keeps the
// real inputs in the DOM, which is what these tests read.
vi.mock("~/hooks/use-fetcher-with-reset", () => ({
  default: () => ({
    Form: ({ children, ...props }: { children: ReactNode }) => (
      <form {...props}>{children}</form>
    ),
    state: "idle",
    data: undefined,
    reset: () => {},
  }),
}));

// why: search params come from the router; the dialog only stringifies them.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams(), () => {}],
}));

// why: the dialog chrome (portal + modal) adds nothing to the form.
vi.mock("~/components/layout/dialog", () => ({
  DialogPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

/** A field as the GET payload lists it. */
function cf(
  overrides: Partial<BulkSettableCustomField> &
    Pick<BulkSettableCustomField, "id" | "type">
): BulkSettableCustomField {
  return {
    name: `Field ${overrides.id}`,
    options: [],
    helpText: null,
    categories: [],
    ...overrides,
  };
}

/** Renders the open dialog with `fields` in the payload. */
function renderWith(fields: BulkSettableCustomField[]) {
  apiResponse.data = { customFields: fields };
  atomValues.set(selectedBulkItemsAtom, [{ id: "a1" }]);
  atomValues.set(selectedBulkItemsCountAtom, 1);
  atomValues.set(bulkDialogAtom, { "custom-field": true });
  return render(<BulkCustomFieldUpdateDialog />);
}

/** Option values of the native `<select name={name}>` Radix renders. */
function optionValues(container: HTMLElement, name: string) {
  const select = container.querySelector<HTMLSelectElement>(
    `select[name="${name}"]`
  );
  if (!select) throw new Error(`No select named ${name}`);
  return {
    select,
    values: Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean),
  };
}

/** Picks a field through the native select, as form autofill would. */
function pickField(container: HTMLElement, id: string) {
  const { select } = optionValues(container, "customFieldId");
  fireEvent.change(select, { target: { value: id } });
}

describe("BulkCustomFieldUpdateDialog", () => {
  beforeEach(() => {
    atomValues.clear();
  });

  it("offers every field from the `customFields` payload", () => {
    const { container } = renderWith([
      cf({ id: "cf-brand", type: "TEXT" }),
      cf({ id: "cf-insured", type: "BOOLEAN" }),
    ]);

    expect(optionValues(container, "customFieldId").values).toEqual([
      "cf-brand",
      "cf-insured",
    ]);
  });

  it("posts a yes/no answer as on or off, and requires one", () => {
    const { container } = renderWith([
      cf({ id: "cf-insured", type: "BOOLEAN" }),
    ]);
    pickField(container, "cf-insured");

    const { select, values } = optionValues(container, "value");
    expect(values).toEqual(["on", "off"]);
    expect(select.required).toBe(true);
  });

  it("posts one of the field's options, never a blank one", () => {
    const { container } = renderWith([
      cf({ id: "cf-brand", type: "OPTION", options: ["Westermo", "", "Moxa"] }),
    ]);
    pickField(container, "cf-brand");

    expect(optionValues(container, "value").values).toEqual([
      "Westermo",
      "Moxa",
    ]);
  });

  it("starts in the only-empty mode", () => {
    const { container } = renderWith([cf({ id: "cf-brand", type: "TEXT" })]);

    const checked = container.querySelector<HTMLInputElement>(
      'input[name="mode"]:checked'
    );
    expect(checked?.value).toBe("EMPTY_ONLY");
  });
});
