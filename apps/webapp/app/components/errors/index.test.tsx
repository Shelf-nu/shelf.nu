/**
 * Tests for {@link ErrorContent}: the report-an-issue wiring (button only
 * shows for authenticated app-layout errors, and the feedback modal receives
 * the error context rendered on the page), the not-found screen for genuine
 * 404s, and the Sentry capture rules for route-error boundary failures.
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

// why: the Sentry SDK is not initialized in tests; captureException is
// spied on so capture-vs-no-capture assertions can check call args. Typed
// with both params (matching how ErrorContent always calls it) so
// `.mock.calls[i][1]` is a real tuple index, not a TS2493 out-of-bounds
// access on an inferred 0-arg signature.
const { mockCaptureException } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(
    (_exception: unknown, _hint: Record<string, unknown>) => "evt_abc"
  ),
}));
vi.mock("@sentry/react-router", () => ({
  captureException: mockCaptureException,
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

// why: Error404Handler's internals (the "switch workspace" form) call
// useFetcher, which needs a full data router; MemoryRouter (used below) is
// not one. ErrorContent's own branching logic — whether it routes to
// Error404Handler at all — is what's under test here, so we assert on the
// props it receives instead of rendering the real component.
const { mockError404Handler } = vi.hoisted(() => ({
  mockError404Handler: vi.fn(
    (_props: { className?: string; additionalData: unknown }) => null
  ),
}));
vi.mock("./error-404-handler", () => ({
  default: mockError404Handler,
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

/**
 * Shape-compatible with react-router's isRouteErrorResponse guard. Defaults
 * reproduce the original fixture (a 500 with a custom title); overrides let
 * individual tests exercise other statuses, labels, and the
 * workspace-switcher `additionalData` shape.
 */
function buildRouteError(overrides?: {
  status?: number;
  message?: string;
  label?: string;
  additionalData?: unknown;
}) {
  return {
    status: overrides?.status ?? 500,
    statusText: "Internal Server Error",
    internal: false,
    data: {
      error: {
        message:
          overrides?.message ?? "Something went wrong while fetching the kit",
        title: "Kit error",
        traceId: "trace_789",
        label: overrides?.label ?? "Kit",
        ...(overrides?.additionalData !== undefined
          ? { additionalData: overrides.additionalData }
          : {}),
      },
    },
  };
}

/**
 * A genuine 404 route-error response with no custom title, so the
 * not-found screen's "Not found" fallback heading is exercised (as opposed
 * to `buildRouteError`, whose fixture always carries a "Kit error" title).
 */
function buildNotFoundRouteError(overrides?: {
  message?: string;
  traceId?: string;
  label?: string;
}) {
  return {
    status: 404,
    statusText: "Not Found",
    internal: false,
    data: {
      error: {
        message: overrides?.message ?? "Audit asset not found",
        traceId: overrides?.traceId ?? "trace_404",
        label: overrides?.label ?? "Audit",
      },
    },
  };
}

/**
 * A router-generated 404: what React Router itself throws for an
 * unmatched/stale URL (an `ErrorResponseImpl` whose `.data` is a plain
 * `Error`), as opposed to `buildNotFoundRouteError`'s Shelf
 * `{ error: { message, traceId, label } }` payload. `isRouteErrorResponse`
 * recognizes this shape (status/statusText/internal/data all present on the
 * object), but `isRouteError` does not — there's no Shelf error payload to
 * read `message`/`traceId`/`label` from, so those stay at their defaults.
 */
function buildRouterNotFoundError() {
  return {
    status: 404,
    statusText: "Not Found",
    internal: true,
    data: new Error('No route matches URL "/stale/path"'),
  };
}

/** The workspace-switcher `additionalData` shape: a resource that exists,
 * but in a different organization the user belongs to. */
function buildWorkspaceSwitcherAdditionalData() {
  return {
    id: "asset_1",
    model: "asset" as const,
    redirectTo: "/assets",
    organization: {
      organization: { id: "org_2", name: "Other workspace" },
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

describe("ErrorContent not-found screen", () => {
  beforeEach(() => {
    mockUser = { id: "user_123" };
    mockError404Handler.mockClear();
  });

  it("renders a calm Not-found screen for a genuine 404 (not the workspace-switcher shape)", () => {
    mockRouteError = buildNotFoundRouteError({
      message: "Audit asset not found",
    });
    renderErrorContent();

    expect(screen.getByText("Not found")).toBeTruthy();
    expect(screen.getByText(/Audit asset not found/)).toBeTruthy();
    expect(screen.getByText(/trace_404/)).toBeTruthy();
    // Not the alarming generic framing
    expect(screen.queryByText(/Oops, something went wrong/i)).toBeNull();
    // Only "Back to home" is offered — no Reload/Report actions
    expect(screen.queryByRole("link", { name: /reload page/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /report this issue/i })
    ).toBeNull();
  });

  it("renders the not-found screen for a router-generated 404 (unmatched/stale URL, no Shelf payload)", () => {
    mockRouteError = buildRouterNotFoundError();
    renderErrorContent();

    expect(screen.getByText("Not found")).toBeTruthy();
    // Generic not-found copy: there is no Shelf `message` to read (the
    // router error's `.data` is a plain Error, not `{ error: {...} }`)
    expect(screen.getByText(/doesn't exist/i)).toBeTruthy();
    // Not the alarming generic framing
    expect(screen.queryByText(/Oops, something went wrong/i)).toBeNull();
    // No Shelf trace id to show for a router-generated 404
    expect(screen.queryByText(/Trace id/)).toBeNull();
    // Only "Back to home" is offered — no Reload/Report actions
    expect(screen.queryByRole("link", { name: /reload page/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /report this issue/i })
    ).toBeNull();
  });

  it("still routes the workspace-switcher 404 shape to <Error404Handler/> (unchanged)", () => {
    const additionalData = buildWorkspaceSwitcherAdditionalData();
    mockRouteError = buildRouteError({
      status: 404,
      message: "Asset not found",
      additionalData,
    });
    renderErrorContent();

    expect(mockError404Handler).toHaveBeenCalled();
    const props = mockError404Handler.mock.calls.at(-1)?.[0];
    expect(props?.additionalData).toEqual(additionalData);
    // Not our new not-found screen
    expect(screen.queryByText("Not found")).toBeNull();
  });
});

describe("ErrorContent capturing route-error boundary failures to Sentry", () => {
  beforeEach(() => {
    mockUser = { id: "user_123" };
    mockCaptureException.mockClear();
    // why: the capture effect is gated on window.env.SENTRY_DSN, mirroring
    // entry.client.tsx's own Sentry.init gate; no real Sentry SDK runs in
    // tests, so this just needs to be truthy
    window.env = { SENTRY_DSN: "test-dsn" } as Window["env"];
  });

  it("captures an unexpected 4xx route error (e.g. 409) with source=error-boundary and the on-screen trace id", async () => {
    mockRouteError = buildRouteError({
      status: 409,
      message: "This asset is already booked for that window",
      label: "Booking conflict",
    });
    renderErrorContent();

    await waitFor(() => expect(mockCaptureException).toHaveBeenCalled());
    const hint = mockCaptureException.mock.calls.at(-1)?.[1];
    expect(hint).toMatchObject({
      tags: {
        source: "error-boundary",
        shelf_trace_id: "trace_789",
        label: "Booking conflict",
        status: "409",
      },
      contexts: { route: { pathname: "/kits" } },
    });
  });

  it("does not capture an expected 403 terminal state (permission/expired claim — normal UX, not a bug)", async () => {
    mockRouteError = buildRouteError({
      status: 403,
      message: "This scan can no longer be updated",
      label: "Scan",
    });
    renderErrorContent();

    // Give the capture effect a chance to run, then assert it did not fire
    await waitFor(() =>
      expect(
        screen.getByText(/This scan can no longer be updated/)
      ).toBeTruthy()
    );
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("does not capture a genuine 404 (not-found screen — expected terminal state)", async () => {
    mockRouteError = buildNotFoundRouteError({
      message: "Audit asset not found",
      traceId: "trace_404",
      label: "Audit",
    });
    renderErrorContent();

    await waitFor(() => expect(screen.getByText("Not found")).toBeTruthy());
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("does not capture a router-generated 404 (unmatched/stale URL — expected terminal state)", async () => {
    mockRouteError = buildRouterNotFoundError();
    renderErrorContent();

    await waitFor(() => expect(screen.getByText("Not found")).toBeTruthy());
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("does not capture the benign workspace-switcher 404 case", async () => {
    mockError404Handler.mockClear();
    mockRouteError = buildRouteError({
      status: 404,
      message: "Asset not found",
      additionalData: buildWorkspaceSwitcherAdditionalData(),
    });
    renderErrorContent();

    await waitFor(() => expect(mockError404Handler).toHaveBeenCalled());
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("does not capture 5xx route errors (already captured server-side)", async () => {
    mockRouteError = buildRouteError({ status: 500 });
    renderErrorContent();

    await waitFor(() =>
      expect(
        screen.getByText(/Something went wrong while fetching the kit/)
      ).toBeTruthy()
    );
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
