/**
 * Tests for the scanner drawer's notice after a save that got no answer.
 *
 * @see {@link file://./scan-submit-failure-alert.tsx}
 */
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  retiredScanSubmitFailureAtom,
  unconfirmedScanSaveAtom,
} from "~/hooks/use-scan-draft";
import type { ScanSubmitFailure } from "~/utils/scan-submit-failure";
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
    Link: ({ to, children, ...rest }: ComponentProps<"a"> & { to: string }) => (
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

  /**
   * A gateway that turned the request away never passed it on, so the notice
   * must not say the save may have gone through, and has nothing to check.
   */
  it("says nothing was saved when a gateway turned the request away", () => {
    mockActionData.mockReturnValue({
      scanSubmitFailure: { kind: "rejected", status: 429 },
    });

    render(
      <ScanSubmitFailureAlert
        savedCheck={{ to: "/bookings/booking-1", label: "Open the booking" }}
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The save was not accepted.");
    expect(alert.textContent).toContain("nothing was saved");
    expect(alert.textContent).not.toContain("may have gone through");
    expect(screen.queryByRole("link")).toBeNull();
  });

  /** Waiting does not make an oversized submission smaller. */
  it("tells the operator to make a too-large submission smaller", () => {
    mockActionData.mockReturnValue({
      scanSubmitFailure: { kind: "rejected", status: 413 },
    });

    render(<ScanSubmitFailureAlert />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("the submission was too large");
    expect(alert.textContent).toContain("Remove some photos or items");
    expect(alert.textContent).not.toContain("Wait a moment");
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

  /**
   * After a reload the failure itself is gone, but a list put back from a
   * draft that was sent in an unanswered save is still marked.
   */
  describe("for a list restored after a save that got no answer", () => {
    function renderMarked(marked: boolean) {
      const store = createStore();
      store.set(unconfirmedScanSaveAtom, marked);
      return render(
        <Provider store={store}>
          <ScanSubmitFailureAlert
            savedCheck={{ to: "/bookings/b-1", label: "Open the booking" }}
          />
        </Provider>
      );
    }

    it("warns that the save may have gone through, with the link to check", () => {
      mockActionData.mockReturnValue(undefined);

      renderMarked(true);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "may have gone through"
      );
      expect(
        screen.getByRole("link", { name: "Open the booking" })
      ).toHaveAttribute("href", "/bookings/b-1");
    });

    it("says nothing for a list without the mark", () => {
      mockActionData.mockReturnValue(undefined);

      renderMarked(false);

      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("keeps the earlier warning and its link beside a refused retry", () => {
      mockActionData.mockReturnValue({
        scanSubmitFailure: { kind: "rejected", status: 429 },
      });

      renderMarked(true);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("The save was not accepted.");
      expect(alert).toHaveTextContent(
        "An earlier save of this list got no answer"
      );
      expect(
        screen.getByRole("link", { name: "Open the booking" })
      ).toBeInTheDocument();
    });

    it("steps aside while the list is being sent again", () => {
      mockActionData.mockReturnValue(undefined);
      mockNavigation.mockReturnValue({ state: "submitting" });

      renderMarked(true);

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  /**
   * The last action answer stays until the next submission. Once its list is
   * emptied, a new list scanned on the same page was never sent.
   */
  it("says nothing about a failure whose list was emptied", () => {
    const failure: ScanSubmitFailure = { kind: "timeout", status: 524 };
    mockActionData.mockReturnValue({ scanSubmitFailure: failure });
    const store = createStore();
    store.set(retiredScanSubmitFailureAtom, failure);

    render(
      <Provider store={store}>
        <ScanSubmitFailureAlert />
      </Provider>
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
