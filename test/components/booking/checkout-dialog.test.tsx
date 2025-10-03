import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import CheckoutDialog from "~/components/booking/checkout-dialog";

vi.mock("~/modules/booking/helpers", () => ({
  isBookingEarlyCheckout: vi.fn(() => false),
}));

vi.mock("@remix-run/react", async () => {
  const actual = await vi.importActual("@remix-run/react");

  return {
    ...(actual as Record<string, unknown>),
    useNavigation: vi.fn(),
    useActionData: vi.fn(),
  };
});

vi.mock("~/utils/confetti", () => ({
  fireConfettiFromElement: vi.fn(() => Promise.resolve()),
}));

import { useNavigation, useActionData } from "@remix-run/react";
import { fireConfettiFromElement } from "~/utils/confetti";

const useNavigationMock = vi.mocked(useNavigation);
const useActionDataMock = vi.mocked(useActionData);
const fireConfettiFromElementMock = vi.mocked(fireConfettiFromElement);

describe("CheckoutDialog confetti", () => {
  const booking = {
    id: "booking-123",
    name: "Sample Booking",
    from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  };

  let navigationState: ReturnType<typeof useNavigationMock>;
  let actionDataState: any;

  beforeEach(() => {
    vi.clearAllMocks();

    navigationState = {
      state: "idle",
      formData: undefined,
    } as any;

    actionDataState = undefined;

    useNavigationMock.mockImplementation(() => navigationState);
    useActionDataMock.mockImplementation(() => actionDataState);
  });

  it("fires confetti when checkout submission succeeds", async () => {
    const { rerender } = render(
      <CheckoutDialog booking={booking} disabled={false} />
    );

    const button = screen.getByRole("button", { name: /check out/i });
    fireEvent.click(button);

    navigationState.state = "submitting";
    const formData = new FormData();
    formData.set("intent", "checkOut");
    navigationState.formData = formData;

    rerender(<CheckoutDialog booking={booking} disabled={false} />);

    actionDataState = { error: null, booking: { id: booking.id } };
    navigationState.state = "idle";
    navigationState.formData = undefined;

    await act(async () => {
      rerender(<CheckoutDialog booking={booking} disabled={false} />);
    });

    await waitFor(() => {
      expect(fireConfettiFromElementMock).toHaveBeenCalledTimes(1);
      expect(fireConfettiFromElementMock).toHaveBeenCalledWith(button);
    });
  });

  it("does not fire confetti when checkout submission fails", async () => {
    const { rerender } = render(
      <CheckoutDialog booking={booking} disabled={false} />
    );

    const button = screen.getByRole("button", { name: /check out/i });
    fireEvent.click(button);

    navigationState.state = "submitting";
    const formData = new FormData();
    formData.set("intent", "checkOut");
    navigationState.formData = formData;

    rerender(<CheckoutDialog booking={booking} disabled={false} />);

    actionDataState = { error: { message: "failed" } };
    navigationState.state = "idle";
    navigationState.formData = undefined;

    await act(async () => {
      rerender(<CheckoutDialog booking={booking} disabled={false} />);
    });

    await waitFor(() => {
      expect(fireConfettiFromElementMock).not.toHaveBeenCalled();
    });
  });
});
