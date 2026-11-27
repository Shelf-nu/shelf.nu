/**
 * Tests for {@link BookingSourceEditor} and {@link useSourceSplit}: one input
 * per source with its free units, the Auto button, pending-only editing once
 * units are out, the loose-units help text and accessible wiring.
 *
 * @see {@link file://./booking-source-editor.tsx}
 */

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SourceEditorData } from "~/modules/booking/sources/source-editor";
import {
  BookingSourceEditor,
  useSourceSplit,
  type BookingSourceEditorProps,
} from "./booking-source-editor";

function editorData(
  overrides: Partial<SourceEditorData> = {}
): SourceEditorData {
  return {
    sliceId: "ba-1",
    mode: "AUTO",
    rows: [
      {
        key: "LOCATION:loc-1",
        locationId: "loc-1",
        label: "Demo Warehouse",
        pending: 8,
        out: 0,
        free: 10,
      },
      {
        key: "LOCATION:loc-2",
        locationId: "loc-2",
        label: "Annex",
        pending: 0,
        out: 0,
        free: 4,
      },
      {
        key: "UNPLACED:",
        locationId: null,
        label: "Unplaced",
        pending: 7,
        out: 0,
        free: 9,
      },
    ],
    unassignedPending: 0,
    unknownOut: 0,
    stranded: [],
    ...overrides,
  };
}

function renderEditor(overrides: Partial<BookingSourceEditorProps> = {}) {
  const editor = overrides.editor ?? editorData();
  const props: BookingSourceEditorProps = {
    editor,
    values: Object.fromEntries(
      editor.rows.map((r) => [r.key, String(r.pending)])
    ),
    edited: false,
    onChange: vi.fn(),
    onAuto: vi.fn(),
    required: 15,
    error: null,
    disabled: false,
    unitLabel: "units",
    ...overrides,
  };
  render(<BookingSourceEditor {...props} />);
  return props;
}

describe("BookingSourceEditor", () => {
  it("shows one input per placement plus Unplaced, each with its free units", () => {
    renderEditor();

    expect(screen.getByLabelText("Demo Warehouse")).toHaveValue(8);
    expect(screen.getByLabelText("Annex")).toHaveValue(0);
    expect(screen.getByLabelText("Unplaced")).toHaveValue(7);
    expect(screen.getByText("10 free")).toBeInTheDocument();
    expect(screen.getByText("4 free")).toBeInTheDocument();
    expect(screen.getByText("9 free")).toBeInTheDocument();
  });

  it("links each input to its free units for assistive technology", () => {
    renderEditor();

    const input = screen.getByLabelText("Annex");
    const hintId = input.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId ?? "")?.textContent).toBe("4 free");
  });

  it("says that free units cover loose units only, not kit units", () => {
    renderEditor();

    expect(
      screen.getByText(/Free counts loose units only/i).textContent
    ).toMatch(/units inside kits are not part of any location/i);
  });

  it("says that free units include this booking's own planned units", () => {
    renderEditor();

    expect(
      screen.getByText(/Free counts loose units only/i).textContent
    ).toMatch(/include the units this booking already plans from each place/i);
  });

  it("reports each change with the source key", () => {
    const props = renderEditor();

    fireEvent.change(screen.getByLabelText("Annex"), {
      target: { value: "3" },
    });

    expect(props.onChange).toHaveBeenCalledWith("LOCATION:loc-2", "3");
  });

  it("offers an Auto button that is a plain button", () => {
    const props = renderEditor();

    const auto = screen.getByRole("button", { name: "Auto" });
    expect(auto).toHaveAttribute("type", "button");
    fireEvent.click(auto);
    expect(props.onAuto).toHaveBeenCalledTimes(1);
  });

  it("disables the inputs and Auto while a submission is in flight", () => {
    renderEditor({ disabled: true });

    expect(screen.getByRole("button", { name: "Auto" })).toBeDisabled();
    expect(screen.getByLabelText("Unplaced")).toBeDisabled();
  });

  it("edits only units still to go out once some are out", () => {
    // ONGOING: 2 out from the warehouse, 6 still pending there.
    const editor = editorData({
      rows: [
        {
          key: "LOCATION:loc-1",
          locationId: "loc-1",
          label: "Demo Warehouse",
          pending: 6,
          out: 2,
          free: 10,
        },
        {
          key: "UNPLACED:",
          locationId: null,
          label: "Unplaced",
          pending: 7,
          out: 0,
          free: 9,
        },
      ],
    });
    renderEditor({ editor, required: 13 });

    expect(screen.getByLabelText("Demo Warehouse")).toHaveValue(6);
    expect(screen.getByText("10 free · 2 out")).toBeInTheDocument();
    expect(
      screen.getByText(/Only those still to go out can move/i)
    ).toBeInTheDocument();
  });

  it("asks for units on Needs a location to be placed", () => {
    renderEditor({ editor: editorData({ unassignedPending: 3 }) });

    expect(screen.getByText(/Needs a location: 3 units/i)).toBeInTheDocument();
  });

  it("shows the message as an alert tied to the inputs", () => {
    renderEditor({ error: "The sources must add up to 15 units." });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The sources must add up to 15 units.");
    expect(
      screen.getByLabelText("Unplaced").getAttribute("aria-describedby")
    ).toContain(alert.id);
  });

  it("shows the running total once the split is edited", () => {
    renderEditor({
      edited: true,
      values: {
        "LOCATION:loc-1": "10",
        "LOCATION:loc-2": "1",
        "UNPLACED:": "0",
      },
    });

    expect(screen.getByText("11 of 15 units placed")).toBeInTheDocument();
  });
});

describe("BookingSourceEditor with units at a former placement", () => {
  const lockedEditor = () =>
    editorData({
      stranded: [
        {
          key: "LOCATION:loc-gone",
          locationId: "loc-gone",
          label: "Old Shed",
          pending: 1,
          out: 2,
        },
      ],
    });

  it("shows no inputs, only the split as text", () => {
    renderEditor({ editor: lockedEditor() });

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText("Demo Warehouse")).toBeInTheDocument();
  });

  it("lists the units still held there", () => {
    renderEditor({ editor: lockedEditor() });

    expect(
      screen.getByText("No longer holds this asset: Old Shed, 2 out, 1 planned")
    ).toBeInTheDocument();
  });

  it("explains why and still offers Auto", () => {
    const props = renderEditor({ editor: lockedEditor() });

    expect(
      screen.getByText(/the split cannot be changed by hand/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(props.onAuto).toHaveBeenCalledTimes(1);
  });
});

describe("useSourceSplit", () => {
  it("starts at the current split and restarts when new data arrives", () => {
    const first = editorData();
    const { result, rerender } = renderHook(
      ({ editor }) => useSourceSplit(editor),
      { initialProps: { editor: first as SourceEditorData | null } }
    );

    expect(result.current.values["LOCATION:loc-1"]).toBe("8");
    act(() => result.current.change("LOCATION:loc-1", "1"));
    expect(result.current.edited).toBe(true);

    const second = editorData({ mode: "MANUAL" });
    rerender({ editor: second });

    expect(result.current.edited).toBe(false);
    expect(result.current.values["LOCATION:loc-1"]).toBe("8");
  });

  it("clears its message when an input changes", () => {
    // One reference: new data restarts the split.
    const editor = editorData();
    const { result } = renderHook(() => useSourceSplit(editor));

    act(() => result.current.setError("Wrong total"));
    expect(result.current.error).toBe("Wrong total");
    act(() => result.current.change("UNPLACED:", "2"));
    expect(result.current.error).toBeNull();
  });
});
