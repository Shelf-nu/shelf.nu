/**
 * Tests for the notice the complete-audit dialog shows when a completion got
 * no answer.
 *
 * The dialog opens on top of the audit scanner's drawer, whose own notice is
 * then behind the overlay. The dialog has to carry it, or the operator can
 * confirm a second time without being told to check first.
 *
 * @see {@link file://./complete-audit-dialog.tsx}
 */
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CompleteAuditDialog from "./complete-audit-dialog";

// why: the notice reads the route's action data and the dialog its submission
// state, which only exist inside a mounted data router. `Form` is reduced to a
// plain form for the same reason.
const mockActionData = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useActionData: () => mockActionData(),
    useNavigation: () => ({ state: "idle" }),
    Form: ({ children, ...props }: ComponentProps<"form">) => (
      <form {...props}>{children}</form>
    ),
  };
});

// why: the photo picker uploads through fetchers and object URLs, neither of
// which this test exercises.
vi.mock("~/components/audit/audit-image-upload-box", () => ({
  AuditImageUploadSection: () => null,
}));

const STATS = {
  expectedCount: 3,
  foundCount: 2,
  missingCount: 1,
  unexpectedCount: 0,
};

function openDialog() {
  render(<CompleteAuditDialog auditName="ZZ Test Audit" stats={STATS} />);
  fireEvent.click(screen.getByRole("button", { name: "Complete Audit" }));
  return screen.getByRole("alertdialog");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CompleteAuditDialog", () => {
  it("shows the save-not-confirmed notice inside the dialog", () => {
    mockActionData.mockReturnValue({
      scanSubmitFailure: { kind: "timeout", status: 524 },
    });

    const dialog = openDialog();

    const alert = screen.getByRole("alert");
    expect(dialog).toContainElement(alert);
    expect(alert.textContent).toContain("The save took too long to answer.");
  });

  it("shows no notice when the last completion had an answer", () => {
    mockActionData.mockReturnValue(undefined);

    openDialog();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * The scan route's client action reads the intent from the URL, so it does
   * not have to parse the photos in the multipart body to find it.
   */
  it("puts the intent in the form's action URL for the audit scanner", () => {
    mockActionData.mockReturnValue(undefined);
    render(
      <CompleteAuditDialog
        auditName="ZZ Test Audit"
        stats={STATS}
        intentInActionUrl
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete Audit" }));

    const form = screen.getByRole("alertdialog").querySelector("form");
    expect(form?.getAttribute("action")).toBe("?intent=complete-audit");
  });

  /**
   * A search-only action resolves against the page the form is on. On the
   * audit page that is whichever tab is open, and not every tab has an action
   * that can complete the audit. Left off, the form keeps the default action:
   * the route that renders it.
   */
  it("keeps the default form action everywhere else", () => {
    mockActionData.mockReturnValue(undefined);

    const dialog = openDialog();

    expect(dialog.querySelector("form")?.hasAttribute("action")).toBe(false);
  });
});
