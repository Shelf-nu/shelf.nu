/**
 * The drawer shows the server's refusal of a check-out, such as a 400 for
 * units leaving from a source that is short for the slice.
 *
 * @see {@link file://./checkout-refusal.tsx}
 */

import { cleanup, render, screen } from "@testing-library/react";
import { useActionData } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckoutRefusal, checkoutRefusalMessage } from "./checkout-refusal";

// why: `useActionData` needs a data router; each case chooses what the
// action returned.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useActionData: vi.fn() };
});

afterEach(() => {
  cleanup();
});

const REFUSAL = {
  error: {
    message: "Not enough units at Studio for this booking.",
    title: "Short at Studio",
    additionalData: {},
    label: "Booking",
  },
};

describe("checkoutRefusalMessage", () => {
  it("reads the message of an error response", () => {
    expect(checkoutRefusalMessage(REFUSAL)).toBe(
      "Not enough units at Studio for this booking."
    );
  });

  it("is empty for no response and for a success", () => {
    expect(checkoutRefusalMessage(undefined)).toBeNull();
    expect(checkoutRefusalMessage({ error: null, success: true })).toBeNull();
  });
});

describe("CheckoutRefusal", () => {
  it("announces the server's refusal", () => {
    vi.mocked(useActionData).mockReturnValue(REFUSAL);

    render(<CheckoutRefusal />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not enough units at Studio for this booking."
    );
  });

  it("renders nothing before a refusal", () => {
    vi.mocked(useActionData).mockReturnValue(undefined);

    render(<CheckoutRefusal />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
