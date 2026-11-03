/**
 * Tests for {@link CancelBookingDialog}: the form posts to the booking's own
 * overview action, so cancelling works from any page, and the server's
 * validation error for the reason is shown in the dialog.
 *
 * @see {@link file://./cancel-booking-dialog.tsx}
 */
import { forwardRef } from "react";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CancelBookingDialog } from "./cancel-booking-dialog";

/** What the mocked fetcher answers with; tests set it before rendering. */
let mockData: unknown;

/** A form that takes the ref `useZorm` hands the fetcher form. */
const MockFetcherForm = forwardRef<HTMLFormElement, { children: ReactNode }>(
  ({ children, ...props }, ref) => (
    <form ref={ref} {...props}>
      {children}
    </form>
  )
);
MockFetcherForm.displayName = "MockFetcherForm";

// why: the real `useFetcher` and `fetcher.Form` need a data router, which a
// component test does not mount. The form is a plain form with the same props.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigation: () => ({ state: "idle" }),
    useFetcher: () => ({
      state: "idle",
      data: mockData,
      submit: vi.fn(),
      Form: MockFetcherForm,
    }),
  };
});

/** Renders the dialog and opens it. */
function renderOpen() {
  const utils = render(
    <CancelBookingDialog booking={{ id: "b1", name: "Studio shoot" }} />
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  return utils;
}

/** A refusal of the reason field, shaped like the action's validation error. */
const REASON_REFUSAL = {
  error: {
    message: "Validation failed",
    additionalData: {
      validationErrors: {
        cancellationReason: { message: "Reason is too long" },
      },
    },
  },
};

describe("CancelBookingDialog", () => {
  it("posts intent=cancel with the reason to the booking's overview action", () => {
    mockData = undefined;
    renderOpen();

    const form = document.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/bookings/b1/overview");
    expect(
      form?.querySelector<HTMLInputElement>('input[name="intent"]')?.value
    ).toBe("cancel");
    expect(form?.querySelector('textarea[name="cancellationReason"]')).not.toBe(
      null
    );
  });

  it("shows the server's cancellationReason error from the fetcher", () => {
    mockData = undefined;
    const { rerender } = renderOpen();

    // The refusal arrives while the dialog is open.
    mockData = REASON_REFUSAL;
    rerender(
      <CancelBookingDialog booking={{ id: "b1", name: "Studio shoot" }} />
    );

    expect(screen.getByText("Reason is too long")).toBeTruthy();
  });

  it("does not show an error that was already there when the dialog opened", () => {
    mockData = REASON_REFUSAL;
    renderOpen();

    expect(screen.queryByText("Reason is too long")).toBeNull();
  });
});
