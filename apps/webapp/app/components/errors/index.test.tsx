/**
 * Tests for {@link ErrorContent}'s report-an-issue wiring: the button only
 * shows for authenticated app-layout errors, and the feedback modal receives
 * the error context (trace id, status, title, message) rendered on the page.
 *
 * @see {@link file://./index.tsx}
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable per-test state driving the mocked hooks
let mockRouteError: unknown;
let mockUser: { id: string } | undefined;

// why: useRouteError/useLocation need a data router; we drive them per test
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useRouteError: () => mockRouteError,
    useLocation: () => ({ pathname: "/kits" }),
  };
});

// why: useUserData reads the app layout's loader data, which only exists
// inside a real router; we toggle it to test the button gating
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => mockUser,
}));

// why: the Sentry SDK is not initialized in tests
vi.mock("@sentry/react-router", () => ({
  captureException: vi.fn(() => "evt_abc"),
}));

// why: the modal's own rendering is covered by feedback-modal.test.tsx;
// here we only assert on the props ErrorContent passes to it
const { mockFeedbackModal } = vi.hoisted(() => ({
  mockFeedbackModal: vi.fn(
    (_props: {
      open: boolean;
      onClose: () => void;
      errorContext?: Record<string, unknown> | null;
    }) => null
  ),
}));
vi.mock("../feedback/feedback-modal", () => ({
  default: mockFeedbackModal,
}));

import { ErrorContent } from "./index";

/** The Back-to-home/Reload link buttons need a router context to render */
function renderErrorContent() {
  return render(
    <MemoryRouter>
      <ErrorContent />
    </MemoryRouter>
  );
}

/** Shape-compatible with react-router's isRouteErrorResponse guard */
function buildRouteError() {
  return {
    status: 500,
    statusText: "Internal Server Error",
    internal: false,
    data: {
      error: {
        message: "Something went wrong while fetching the kit",
        title: "Kit error",
        traceId: "trace_789",
      },
    },
  };
}

describe("ErrorContent report-an-issue", () => {
  beforeEach(() => {
    // Reset both calls and any per-test implementation (e.g. the throwing
    // one in the chunk-crash test), then restore the render-nothing default
    mockFeedbackModal.mockReset();
    mockFeedbackModal.mockImplementation(() => null);
    mockRouteError = buildRouteError();
    mockUser = { id: "user_123" };
  });

  it("shows the report button for authenticated layout errors", () => {
    renderErrorContent();
    expect(
      screen.getByRole("button", { name: /report this issue/i })
    ).toBeTruthy();
  });

  it("hides the report button when the app layout did not render", () => {
    mockUser = undefined;
    renderErrorContent();
    expect(
      screen.queryByRole("button", { name: /report this issue/i })
    ).toBeNull();
    expect(mockFeedbackModal).not.toHaveBeenCalled();
  });

  it("mounts the modal only when the report button is clicked, with the rendered error details", async () => {
    renderErrorContent();

    // Lazy + closed: nothing mounted (keeps the modal out of the root chunk
    // and its hooks off every error render)
    expect(mockFeedbackModal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /report this issue/i }));

    await waitFor(() => expect(mockFeedbackModal).toHaveBeenCalled());
    const props = mockFeedbackModal.mock.calls.at(-1)?.[0];
    expect(props?.open).toBe(true);
    expect(props?.errorContext).toMatchObject({
      traceId: "trace_789",
      errorStatus: "500",
      errorTitle: "Kit error",
      errorMessage: "Something went wrong while fetching the kit",
    });
  });

  it("still renders the error message and trace id", () => {
    renderErrorContent();
    expect(
      screen.getByText(/Something went wrong while fetching the kit/)
    ).toBeTruthy();
    expect(screen.getByText(/trace_789/)).toBeTruthy();
  });

  it("hides the report UI instead of blanking the page when the modal crashes", async () => {
    // ErrorContent IS the app-wide boundary: a modal chunk-load failure must
    // not escape it. The local boundary hides the report UI instead.
    // why: silence React's expected error-boundary console noise
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockFeedbackModal.mockImplementation(() => {
      throw new Error("Failed to fetch dynamically imported module");
    });

    renderErrorContent();
    fireEvent.click(screen.getByRole("button", { name: /report this issue/i }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /report this issue/i })
      ).toBeNull()
    );
    // The error page itself survives
    expect(
      screen.getByText(/Something went wrong while fetching the kit/)
    ).toBeTruthy();

    consoleError.mockRestore();
  });
});
