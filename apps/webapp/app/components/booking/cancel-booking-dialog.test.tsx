/**
 * Tests for {@link CancelBookingDialog}: the form posts to the booking's own
 * overview action, so cancelling works from any page, and the server's
 * validation error for the reason is shown in the dialog.
 *
 * @see {@link file://./cancel-booking-dialog.tsx}
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CancelBookingDialog } from "./cancel-booking-dialog";

/** What the mocked fetcher answers with; tests set it before rendering. */
let mockData: unknown;

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
      Form: ({ children, ...props }: { children: ReactNode }) => (
        <form {...props}>{children}</form>
      ),
    }),
  };
});

/** Renders the dialog and opens it. */
function renderOpen() {
  render(<CancelBookingDialog booking={{ id: "b1", name: "Studio shoot" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
}

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
    mockData = {
      error: {
        message: "Validation failed",
        additionalData: {
          validationErrors: {
            cancellationReason: { message: "Reason is too long" },
          },
        },
      },
    };
    renderOpen();

    expect(screen.getByText("Reason is too long")).toBeTruthy();
  });
});
