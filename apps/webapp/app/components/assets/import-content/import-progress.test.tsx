/**
 * ImportProgress - component tests
 *
 * Covers what the progress view shows for each import status and when it polls:
 * only while the import is active and the tab is visible, with an immediate
 * catch-up refetch when a hidden tab returns.
 *
 * @see {@link file://./import-progress.tsx}
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, useLoaderData } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssetImportStatusPayload,
  ImportWarning,
} from "~/modules/asset-import/types";
import { ImportProgress } from "./import-progress";

const { refetch, captured } = vi.hoisted(() => ({
  refetch: vi.fn(),
  captured: {
    onSuccess: undefined as
      | ((response: { import?: unknown }) => void)
      | undefined,
  },
}));

// why: polling goes over the network; the test only observes when the hook
// asks for a refetch
vi.mock("~/hooks/use-api-query", () => ({
  default: vi.fn(
    (options: { onSuccess?: (response: { import?: unknown }) => void }) => {
      captured.onSuccess = options.onSuccess;
      return {
        refetch,
        isLoading: false,
        error: undefined,
        data: undefined,
      };
    }
  ),
}));

/** Builds a status payload; override only what a test cares about. */
function makeStatus(
  overrides: Partial<AssetImportStatusPayload> = {}
): AssetImportStatusPayload {
  return {
    id: "import-1",
    status: "RUNNING",
    phase: "ROWS",
    fileName: "assets.csv",
    totalRows: 965,
    processedRows: 300,
    errorMessage: null,
    warningCount: 0,
    completedAt: null,
    isMine: true,
    ...overrides,
  };
}

/** Renders the view inside a router (links, fetchers and revalidation). */
function renderProgress(
  initial: AssetImportStatusPayload,
  warnings: ImportWarning[] = []
) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <ImportProgress
          importId="import-1"
          initial={initial}
          warnings={warnings}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

/** Sets what `document.visibilityState` reports and announces the change. */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  refetch.mockReset();
  // why: the poll interval is two seconds; fake time keeps the test instant.
  // shouldAdvanceTime lets the router stub's own async setup still resolve.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ImportProgress", () => {
  it("shows the waiting state for a queued import", async () => {
    renderProgress(
      makeStatus({ status: "QUEUED", phase: "PREPARE", processedRows: 0 })
    );

    expect(await screen.findByText("Waiting to start...")).toBeInTheDocument();
    expect(screen.getByLabelText("Import progress")).toHaveAttribute(
      "aria-valuenow",
      "0"
    );
  });

  it("shows the row count and percentage while running", async () => {
    renderProgress(makeStatus());

    expect(
      await screen.findByText("Imported 300 of 965 assets")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Import progress")).toHaveAttribute(
      "aria-valuenow",
      "31"
    );
    expect(
      screen.getByText(
        "You can leave this page. We will email you when it is done."
      )
    ).toBeInTheDocument();
  });

  it("polls while running", async () => {
    renderProgress(makeStatus());
    await screen.findByText("Imported 300 of 965 assets");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(refetch).toHaveBeenCalled();
  });

  it("does not poll a completed import", async () => {
    renderProgress(
      makeStatus({ status: "COMPLETED", phase: "FINALIZE", processedRows: 965 })
    );
    await screen.findByText("965 assets imported");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(refetch).not.toHaveBeenCalled();
  });

  it("pauses polling while the tab is hidden and catches up when it returns", async () => {
    renderProgress(makeStatus());
    await screen.findByText("Imported 300 of 965 assets");

    act(() => {
      setVisibility("hidden");
    });
    refetch.mockClear();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(refetch).not.toHaveBeenCalled();

    act(() => {
      setVisibility("visible");
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the failure with a Resume submit button", async () => {
    renderProgress(
      makeStatus({
        status: "FAILED",
        errorMessage: "Could not create the asset model",
      })
    );

    expect(
      await screen.findByText("Could not create the asset model")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Imported 300 of 965 before it stopped.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resume import" })
    ).toHaveAttribute("type", "submit");
  });

  it("lists the warnings of a completed import", async () => {
    renderProgress(
      makeStatus({
        status: "COMPLETED",
        phase: "FINALIZE",
        processedRows: 965,
        warningCount: 2,
      }),
      [
        { row: 4, title: "QR code", message: "QR code is already linked" },
        { row: 9, title: "Barcode", message: "Barcode is a duplicate" },
      ]
    );

    expect(
      await screen.findByText("2 rows imported with a warning")
    ).toBeInTheDocument();
    expect(screen.getByText("Warnings")).toBeInTheDocument();
    expect(screen.getByText("QR code is already linked")).toBeInTheDocument();
    expect(screen.getByText("Barcode is a duplicate")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View assets" })).toHaveAttribute(
      "href",
      "/assets"
    );
  });

  it("revalidates the loader once when the import reaches a terminal status", async () => {
    let loads = 0;
    // Created once: the hook tells a newer poll from the loader payload by
    // identity, so `initial` must be stable across renders like loader data.
    const initial = makeStatus();
    const Stub = createRoutesStub([
      {
        path: "/",
        // why: counts loader runs; there is no server in a component test
        loader: () => {
          loads += 1;
          return null;
        },
        Component: () => (
          <ImportProgress importId="import-1" initial={initial} warnings={[]} />
        ),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByText("Imported 300 of 965 assets");
    expect(loads).toBe(1);

    act(() => {
      captured.onSuccess?.({
        import: makeStatus({
          status: "COMPLETED",
          phase: "FINALIZE",
          processedRows: 965,
        }),
      });
    });
    await screen.findByText("965 assets imported");
    await vi.waitFor(() => expect(loads).toBe(2));

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(loads).toBe(2);
  });

  it("starts polling again after Resume reloads a queued import", async () => {
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    let serverStatus: AssetImportStatusPayload = makeStatus({
      status: "FAILED",
      errorMessage: "Worker stopped",
    });
    const Stub = createRoutesStub([
      {
        path: "/",
        // why: stands in for the page loader and its resume action
        loader: () => ({ ...serverStatus }),
        action: () => {
          serverStatus = makeStatus({ status: "QUEUED", phase: "PREPARE" });
          return Promise.resolve({ error: null, success: true });
        },
        Component: () => {
          const initial = useLoaderData() as AssetImportStatusPayload;
          return (
            <ImportProgress
              importId="import-1"
              initial={initial}
              warnings={[]}
            />
          );
        },
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByText("Worker stopped");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(refetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Resume import" }));
    await screen.findByText("Waiting to start...");
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(refetch).toHaveBeenCalled();
  });
});
