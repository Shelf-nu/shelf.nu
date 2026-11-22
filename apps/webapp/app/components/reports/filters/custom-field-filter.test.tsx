/**
 * "Custom field is value" picker: where each field type's values come from.
 *
 * OPTION and BOOLEAN values arrive with the page. A TEXT field's values are
 * read from `/api/reports/custom-field-values` only when the field is opened,
 * so the report page never pays for that aggregate. The fixture below has the
 * shape that route answers with (pinned by its own route test).
 *
 * @see {@link file://./custom-field-filter.tsx}
 * @see {@link file://../../../routes/api+/reports.custom-field-values.ts}
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReportCustomFieldOption,
  ReportCustomFieldValuesPayload,
} from "~/modules/reports/types";
import { CustomFieldFilter } from "./custom-field-filter";

const TEXT_FIELD: ReportCustomFieldOption = {
  id: "f-text",
  name: "Fund",
  type: "TEXT",
  values: [],
  hasMoreValues: false,
  valuesOnDemand: true,
};

const OTHER_TEXT_FIELD: ReportCustomFieldOption = {
  id: "f-room",
  name: "Room",
  type: "TEXT",
  values: [],
  hasMoreValues: false,
  valuesOnDemand: true,
};

const OPTION_FIELD: ReportCustomFieldOption = {
  id: "f-opt",
  name: "Colour",
  type: "OPTION",
  values: ["Red", "Blue"],
  hasMoreValues: false,
  valuesOnDemand: false,
};

/** Renders the picker inside a data router, which `useSearchParams` needs. */
function renderPicker() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <CustomFieldFilter
          customFields={[TEXT_FIELD, OTHER_TEXT_FIELD, OPTION_FIELD]}
        />
      ),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

/** Opens the popover and picks `name` from the field list. */
async function openField(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: /Custom field/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(name) })
  );
}

// why: the values route is a network read; the picker's contract is what it
// asks for and what it shows from the answer.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CustomFieldFilter", () => {
  it("reads a TEXT field's values when it is opened, and offers typing when there are more", async () => {
    const answer: ReportCustomFieldValuesPayload = {
      customFieldId: "f-text",
      values: ["Perkins", "General"],
      hasMore: true,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(answer)));

    renderPicker();
    // Nothing is read until a TEXT field is opened.
    expect(fetchMock).not.toHaveBeenCalled();

    await openField("Fund");

    expect(
      await screen.findByRole("button", { name: "Perkins" })
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "General" })).toBeVisible();
    expect(screen.getByLabelText(/Type an exact value/)).toBeVisible();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/reports/custom-field-values?customFieldId=f-text"
    );
  });

  it("shows an OPTION field's own values without a request", async () => {
    renderPicker();

    await openField("Colour");

    expect(await screen.findByRole("button", { name: "Red" })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so when the values cannot be loaded", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Forbidden" } }), {
        status: 403,
      })
    );

    renderPicker();
    await openField("Fund");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the values for this field."
    );
  });

  it("keeps a failed read with its own field, so the next field still loads", async () => {
    const roomAnswer: ReportCustomFieldValuesPayload = {
      customFieldId: "f-room",
      values: ["Room 4"],
      hasMore: false,
    };
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify(roomAnswer)));

    renderPicker();
    await openField("Fund");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the values for this field."
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to fields" }));
    fireEvent.click(await screen.findByRole("button", { name: /Room/ }));

    expect(await screen.findByRole("button", { name: "Room 4" })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads the field again when it is reopened after a failure", async () => {
    const answer: ReportCustomFieldValuesPayload = {
      customFieldId: "f-text",
      values: ["Perkins"],
      hasMore: false,
    };
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify(answer)));

    renderPicker();
    await openField("Fund");
    expect(await screen.findByRole("alert")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Back to fields" }));
    fireEvent.click(await screen.findByRole("button", { name: /Fund/ }));

    expect(
      await screen.findByRole("button", { name: "Perkins" })
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
