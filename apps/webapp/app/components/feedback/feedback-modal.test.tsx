/**
 * Tests for {@link FeedbackModal} branching: the regular feedback form vs
 * the error-report variant (type toggle hidden, error details as hidden
 * fields, reassurance notice) and the auto-captured page context fields.
 *
 * @see {@link file://./feedback-modal.tsx}
 */
import type React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FeedbackModal from "./feedback-modal";

// why: useFetcher needs a data router; we only assert on rendered markup,
// so a static idle fetcher with a plain <form> stand-in is enough
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle" as const,
      data: undefined,
      submit: vi.fn(),
      load: vi.fn(),
      Form: (props: React.ComponentProps<"form">) => <form {...props} />,
    }),
  };
});

// why: useDisabled reads navigation state from the router; stabilise to false
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

// why: the Crisp SDK touches window globals it expects the real app to set up
vi.mock("crisp-sdk-web", () => ({
  Crisp: { chat: { open: vi.fn() } },
}));

const ERROR_CONTEXT = {
  traceId: "trace_789",
  sentryEventId: "evt_abc",
  errorStatus: "500",
  errorTitle: "Oops, something went wrong",
  errorMessage: "Something went wrong while fetching the kit",
};

/** Reads a hidden input by name from the portal-rendered form */
function getHiddenInput(name: string): HTMLInputElement | null {
  return document.querySelector(`input[type="hidden"][name="${name}"]`);
}

describe("FeedbackModal", () => {
  it("shows the Issue/Idea toggle for regular feedback", () => {
    render(<FeedbackModal open onClose={vi.fn()} />);
    expect(screen.getByText("Share feedback")).toBeTruthy();
    // Exact names: the dialog backdrop has role="button" and its accessible
    // name concatenates all dialog text, so regex queries would be ambiguous
    expect(
      screen.getByRole("button", { name: "Issue" }).closest("div.hidden")
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Idea" })).toBeTruthy();
    expect(
      screen.queryByText(/attached to your report automatically/i)
    ).toBeNull();
  });

  it("captures the current page and viewport as hidden fields", () => {
    render(<FeedbackModal open onClose={vi.fn()} />);
    expect(getHiddenInput("currentUrl")?.value).toBe(window.location.href);
    expect(getHiddenInput("viewport")?.value).toMatch(/^\d+x\d+ @[\d.]+x$/);
  });

  it("renders the error-report variant when errorContext is set", () => {
    render(
      <FeedbackModal open onClose={vi.fn()} errorContext={ERROR_CONTEXT} />
    );

    expect(screen.getByText("Report this issue")).toBeTruthy();
    // The toggle is hidden: an error report is always an issue
    expect(
      screen.getByRole("button", { name: "Issue" }).closest("div.hidden")
    ).toBeTruthy();
    // The user is told the technical details travel along
    expect(
      screen.getByText(/attached to your report automatically/i)
    ).toBeTruthy();
    expect(screen.getByText(/trace_789/)).toBeTruthy();
  });

  it("attaches the error details as hidden fields", () => {
    render(
      <FeedbackModal open onClose={vi.fn()} errorContext={ERROR_CONTEXT} />
    );

    expect(getHiddenInput("type")?.value).toBe("issue");
    expect(getHiddenInput("traceId")?.value).toBe("trace_789");
    expect(getHiddenInput("sentryEventId")?.value).toBe("evt_abc");
    expect(getHiddenInput("errorStatus")?.value).toBe("500");
    expect(getHiddenInput("errorTitle")?.value).toBe(
      "Oops, something went wrong"
    );
    expect(getHiddenInput("errorMessage")?.value).toBe(
      "Something went wrong while fetching the kit"
    );
  });

  it("omits error hidden fields for regular feedback", () => {
    render(<FeedbackModal open onClose={vi.fn()} />);
    expect(getHiddenInput("traceId")).toBeNull();
    expect(getHiddenInput("sentryEventId")).toBeNull();
    expect(getHiddenInput("errorStatus")).toBeNull();
  });

  it("truncates oversized error details to the schema limits", () => {
    // An unclamped value would fail zorm validation on a hidden field and
    // silently block the submit with no visible error
    render(
      <FeedbackModal
        open
        onClose={vi.fn()}
        errorContext={{ ...ERROR_CONTEXT, errorMessage: "x".repeat(5000) }}
      />
    );
    expect(getHiddenInput("errorMessage")?.value.length).toBe(3000);
  });

  it("discloses the auto-captured context in the regular variant", () => {
    render(<FeedbackModal open onClose={vi.fn()} />);
    expect(
      screen.getByText(/included automatically to help us debug/i)
    ).toBeTruthy();
  });
});
