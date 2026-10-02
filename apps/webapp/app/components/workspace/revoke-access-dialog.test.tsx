/**
 * Smoke tests for {@link RevokeAccessDialog}.
 *
 * Cover the dialog-side contract only: the confirmation renders the affected
 * user's identity, confirming submits `intent=revokeAccess` for that user,
 * Cancel closes without submitting, server errors render inside the dialog,
 * and the SSO group-mapping note appears only for SSO users. Server-side
 * behaviour (owner guard, membership deletion, email) is covered by the
 * `resolveUserAction` / `revokeAccessToOrganization` tests.
 *
 * @see {@link file://./revoke-access-dialog.tsx}
 */

import type React from "react";
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RevokeAccessDialog } from "./revoke-access-dialog";

/**
 * Mutable per-test fetcher state. Tests reassign before render to control the
 * fetcher's lifecycle (e.g. set `data.error` to assert in-dialog errors).
 */
type FetcherState = {
  state: "idle" | "submitting" | "loading";
  data: { error?: { message: string } } | undefined;
};

let mockFetcherState: FetcherState = { state: "idle", data: undefined };
let mockSubmit = vi.fn();

// why: useFetcher returns a Form component + state we need to control per
// test. Wrap the form so submissions surface as native `submit` events that
// our `mockSubmit` spy captures with the form's field values.
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
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            mockSubmit({
              intent: formData.get("intent"),
              userId: formData.get("userId"),
            });
            onSubmit?.(e);
          }}
        >
          {children}
        </form>
      ),
      submit: mockSubmit,
      load: vi.fn(),
    }),
    useActionData: () => undefined,
    useNavigation: () => ({ state: "idle" }),
  };
});

// why: useDisabled depends on useNavigation plumbing; stabilise to `false`
// so button availability is deterministic in tests.
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

// why: AlertDialog from `~/components/shared/modal` uses Radix's AlertDialog
// primitive, which portals content out of the test root. Swap it for a simple
// `open ? children : null` shell so the controlled `open` prop drives
// visibility and querying works through the regular RTL roots.
vi.mock("~/components/shared/modal", () => {
  const AlertDialog = ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) => <>{open ? children : null}</>;
  const AlertDialogContent = ({ children }: { children: ReactNode }) => (
    <div role="alertdialog">{children}</div>
  );
  const AlertDialogHeader = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  const AlertDialogTitle = ({ children }: { children: ReactNode }) => (
    <h2>{children}</h2>
  );
  const AlertDialogDescription = ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  );
  const AlertDialogFooter = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
  };
});

function renderDialog(
  props: Partial<React.ComponentProps<typeof RevokeAccessDialog>> = {}
) {
  return render(
    <RevokeAccessDialog
      userId="user-1"
      name="Luke Safranek"
      email="luke@example.edu"
      isSSO={false}
      open
      onOpenChange={vi.fn()}
      {...props}
    />
  );
}

describe("RevokeAccessDialog", () => {
  beforeEach(() => {
    mockFetcherState = { state: "idle", data: undefined };
    mockSubmit = vi.fn();
  });

  it("renders nothing while closed", () => {
    renderDialog({ open: false });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("names the affected user in the confirmation copy", () => {
    renderDialog();

    expect(
      screen.getByRole("heading", { name: "Revoke access" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Luke Safranek (luke@example.edu)")
    ).toBeInTheDocument();
  });

  it("falls back to the email when no name is available", () => {
    renderDialog({ name: undefined });

    expect(screen.getByText("luke@example.edu")).toBeInTheDocument();
  });

  it("submits intent=revokeAccess for the target user on confirm", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));

    expect(mockSubmit).toHaveBeenCalledWith({
      intent: "revokeAccess",
      userId: "user-1",
    });
  });

  it("closes without submitting on Cancel", () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("renders the server error inside the dialog", () => {
    mockFetcherState = {
      state: "idle",
      data: {
        error: {
          message:
            "Only the workspace owner can revoke an Administrator's access.",
        },
      },
    };
    renderDialog();

    expect(
      screen.getByText(
        "Only the workspace owner can revoke an Administrator's access."
      )
    ).toBeInTheDocument();
  });

  it("shows the SSO group-mapping note only for SSO users", () => {
    const { unmount } = renderDialog({ isSSO: true });

    expect(screen.getByText(/signs in via SSO/)).toBeInTheDocument();

    unmount();
    renderDialog({ isSSO: false });

    expect(screen.queryByText(/signs in via SSO/)).not.toBeInTheDocument();
  });
});
