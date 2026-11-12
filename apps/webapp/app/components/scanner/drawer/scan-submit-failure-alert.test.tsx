/**
 * Tests for the scanner drawer's notice after a save that got no answer.
 *
 * @see {@link file://./scan-submit-failure-alert.tsx}
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScanSubmitFailureAlert } from "./scan-submit-failure-alert";

// why: the notice reads the route's action data and navigation state, which
// only exist inside a mounted data router. These tests drive them directly.
const mockActionData = vi.fn();
const mockNavigation = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useActionData: () => mockActionData(),
    useNavigation: () => mockNavigation(),
    // why: the shared Button renders a router Link for `to`, which needs a
    // router context. A plain anchor keeps the href and target assertable.
    Link: ({ to, children, ...rest }: any) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

const TIMEOUT = { scanSubmitFailure: { kind: "timeout", status: 524 } };

beforeEach(() => {
  vi.clearAllMocks();
  mockNavigation.mockReturnValue({ state: "idle" });
});

describe("ScanSubmitFailureAlert", () => {
  it("renders nothing before any save", () => {
    mockActionData.mockReturnValue(undefined);

    render(<ScanSubmitFailureAlert />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing for a refusal the server answered itself", () => {
    mockActionData.mockReturnValue({ error: { message: "Not allowed" } });

    render(<ScanSubmitFailureAlert />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a timed-out save may have gone through and the list is kept", () => {
    mockActionData.mockReturnValue(TIMEOUT);

    render(<ScanSubmitFailureAlert />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The save took too long to answer.");
    expect(alert.textContent).toContain("Your scanned list is still here.");
    expect(alert.textContent).toContain(
      "The save may have gone through anyway, so check before you confirm again."
    );
  });

  it.each([
    ["server", "The save could not be confirmed."],
    ["network", "The connection dropped during the save."],
  ])("names a %s failure", (kind, headline) => {
    mockActionData.mockReturnValue({
      scanSubmitFailure: { kind, status: null },
    });

    render(<ScanSubmitFailureAlert />);

    expect(screen.getByRole("alert").textContent).toContain(headline);
  });

  it("links to where the save can be checked, in a new tab", () => {
    mockActionData.mockReturnValue(TIMEOUT);

    render(
      <ScanSubmitFailureAlert
        savedCheck={{ to: "/bookings/booking-1", label: "Open the booking" }}
      />
    );

    const link = screen.getByRole("link", { name: "Open the booking" });
    expect(link.getAttribute("href")).toBe("/bookings/booking-1");
    // A same-tab link would leave the scanner and drop the list it protects.
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("hides while a retry is in flight", () => {
    mockActionData.mockReturnValue(TIMEOUT);
    mockNavigation.mockReturnValue({ state: "submitting" });

    render(<ScanSubmitFailureAlert />);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
