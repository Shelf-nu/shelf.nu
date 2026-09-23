/**
 * Tests for {@link ModelQuantityRows}.
 *
 * What is pinned here is the additive framing: the word on the input, and the
 * hint's projected total against availability. A user who types three against
 * a model already reserving five is creating eight, and the row has to say so
 * before they submit.
 *
 * Also pinned is the silence when no booking window is known — a number
 * computed without a window would be a confident wrong answer.
 *
 * No mocks: the component is presentational, takes plain props and calls plain
 * callbacks.
 *
 * happy-dom computes no layout and applies no CSS, so nothing here asserts
 * anything visual; these tests cover the text and the wiring only.
 *
 * @see {@link file://./model-quantity-rows.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelQuantityRow } from "./model-quantity-rows";
import { ModelQuantityRows } from "./model-quantity-rows";

/**
 * A row with the defaults every test shares, so each test states only the
 * fields it is about.
 *
 * @param overrides - The fields under test
 * @returns One {@link ModelQuantityRow}
 */
function row(overrides: Partial<ModelQuantityRow> = {}): ModelQuantityRow {
  return { assetModelId: "m1", name: "Model", ...overrides };
}

describe("ModelQuantityRows", () => {
  it("labels the input Add, never Set or Quantity", () => {
    // The write is additive. The label is the first thing read and the last
    // thing doubted — "Quantity" reads as "make it this many".
    render(
      <ModelQuantityRows
        rows={[row({ name: "MacBook" })]}
        quantities={{ m1: 1 }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/^add$/i)).toBeInTheDocument();
  });

  it("shows the projected total against availability when already reserved", () => {
    render(
      <ModelQuantityRows
        rows={[row({ alreadyReserved: 5, available: 12 })]}
        quantities={{ m1: 3 }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText(/5 already reserved/i)).toBeInTheDocument();
    expect(screen.getByText(/8 of 12 available/i)).toBeInTheDocument();
  });

  it("omits the reserved clause when the model is not yet on the booking", () => {
    render(
      <ModelQuantityRows
        rows={[row({ available: 12 })]}
        quantities={{ m1: 3 }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.queryByText(/already reserved/i)).toBeNull();
    expect(screen.getByText(/3 of 12 available/i)).toBeInTheDocument();
  });

  it("shows the quantity alone before a booking window is known", () => {
    // Availability depends on the window. Showing a number computed without
    // one would be a confident wrong answer.
    render(
      <ModelQuantityRows
        rows={[row({})]}
        quantities={{ m1: 3 }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.queryByText(/available/i)).toBeNull();
    expect(screen.getByLabelText(/^add$/i)).toHaveValue(3);
  });

  it("removes a single model without disturbing the others", () => {
    // A user who over-selected must be able to drop one row rather than
    // close, re-select and start again.
    const onRemove = vi.fn();
    render(
      <ModelQuantityRows
        rows={[row({ assetModelId: "m1" }), row({ assetModelId: "m2" })]}
        quantities={{ m1: 1, m2: 1 }}
        onChange={vi.fn()}
        onRemove={onRemove}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[1]);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("m2");
  });

  it("defaults each model to 1 and reports changes per model", () => {
    const onChange = vi.fn();
    render(
      <ModelQuantityRows
        rows={[row({ assetModelId: "m1" }), row({ assetModelId: "m2" })]}
        quantities={{}}
        onChange={onChange}
        onRemove={vi.fn()}
      />
    );

    const inputs = screen.getAllByLabelText(/^add$/i);
    expect(inputs[0]).toHaveValue(1);
    expect(inputs[1]).toHaveValue(1);

    fireEvent.change(inputs[1], { target: { value: "4" } });

    expect(onChange).toHaveBeenCalledWith("m2", 4);
  });
});
