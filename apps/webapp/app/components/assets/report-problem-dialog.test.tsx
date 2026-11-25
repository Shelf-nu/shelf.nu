/**
 * Tests for {@link ReportProblemDialog}.
 *
 * The dialog answers only the report sent from the current opening: an old
 * success or refusal held by the keyed fetcher must not show on a fresh
 * opening. It also refuses text the schema refuses before anything is sent,
 * and hides a server refusal once the member edits the text.
 *
 * @see {@link file://./report-problem-dialog.tsx}
 */
import type React from "react";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReportProblemDialog } from "./report-problem-dialog";

type FetcherState = {
  state: "idle" | "submitting" | "loading";
  data: { emailed?: boolean; error?: { message?: string } | null } | undefined;
};

let mockFetcherState: FetcherState = { state: "idle", data: undefined };
const mockSubmit = vi.fn();

// why: the dialog reads a keyed fetcher; each test sets what it holds and
// re-renders to move it through submitting and idle without a data router
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      ...mockFetcherState,
      Form: ({
        children,
        onSubmit,
        ...rest
      }: {
        children: ReactNode;
        onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
        [key: string]: unknown;
      }) => (
        <form
          {...rest}
          onSubmit={(e) => {
            onSubmit?.(e);
            if (!e.defaultPrevented) {
              mockSubmit(new FormData(e.currentTarget).get("content"));
            }
            e.preventDefault();
          }}
        >
          {children}
        </form>
      ),
      submit: mockSubmit,
      load: vi.fn(),
    }),
    useNavigation: () => ({ state: "idle" }),
  };
});

// why: useDisabled reads the router's navigation state; the buttons' own
// state is not under test here
vi.mock("~/hooks/use-disabled", () => ({ useDisabled: () => false }));

// why: Radix AlertDialog portals out of the test root and manages `open`
// itself; a plain `open ? children : null` shell lets the controlled prop
// drive visibility, as it does in the page
vi.mock("~/components/shared/modal", () => {
  const Pass = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: ({
      open,
      children,
    }: {
      open?: boolean;
      children: ReactNode;
    }) => <>{open ? children : null}</>,
    AlertDialogContent: ({ children }: { children: ReactNode }) => (
      <div role="alertdialog">{children}</div>
    ),
    AlertDialogHeader: Pass,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => (
      <h2>{children}</h2>
    ),
    AlertDialogDescription: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogFooter: Pass,
  };
});

function dialog(open = true) {
  return (
    <ReportProblemDialog
      assetId="asset-1"
      assetTitle="ZZ Camera"
      open={open}
      onOpenChange={vi.fn()}
    />
  );
}

function typeReport(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "What is wrong?" }), {
    target: { value: text },
  });
}

describe("ReportProblemDialog", () => {
  beforeEach(() => {
    mockFetcherState = { state: "idle", data: undefined };
    mockSubmit.mockClear();
  });

  it("does not show an earlier opening's success on a fresh opening", () => {
    mockFetcherState = {
      state: "idle",
      data: { emailed: true, error: null },
    };

    render(dialog());

    expect(
      screen.getByRole("heading", { name: "Report a problem" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Report sent")).not.toBeInTheDocument();
  });

  it("says where the report went once this opening's report is accepted", () => {
    const { rerender } = render(dialog());
    typeReport("Lens is cracked");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(mockSubmit).toHaveBeenCalledWith("Lens is cracked");

    mockFetcherState = { state: "submitting", data: undefined };
    rerender(dialog());
    mockFetcherState = {
      state: "idle",
      data: { emailed: true, error: null },
    };
    rerender(dialog());

    expect(
      screen.getByRole("heading", { name: "Report sent" })
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your report is saved in the asset's history and is being emailed to the owners, administrators and managers of this workspace."
    );
  });

  it("says only that no email was sent when nobody was emailed", () => {
    const { rerender } = render(dialog());
    typeReport("Lens is cracked");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    mockFetcherState = { state: "submitting", data: undefined };
    rerender(dialog());
    mockFetcherState = {
      state: "idle",
      data: { emailed: false, error: null },
    };
    rerender(dialog());

    expect(screen.getByRole("status")).toHaveTextContent(
      "Your report is saved in the asset's history. No email was sent."
    );
  });

  it("refuses text that is too short without sending it", () => {
    render(dialog());
    typeReport("ab");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText("Describe the problem in at least 3 characters.")
    ).toBeInTheDocument();
  });

  it("shows a server refusal until the member edits the text", () => {
    const { rerender } = render(dialog());
    typeReport("Lens is cracked");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    mockFetcherState = { state: "submitting", data: undefined };
    rerender(dialog());
    mockFetcherState = {
      state: "idle",
      data: { error: { message: "ZZ Camera is archived." } },
    };
    rerender(dialog());

    expect(screen.getByText("ZZ Camera is archived.")).toBeInTheDocument();

    typeReport("Lens is cracked and loose");

    expect(
      screen.queryByText("ZZ Camera is archived.")
    ).not.toBeInTheDocument();
  });
});
