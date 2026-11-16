/**
 * Where the audit comment delete form posts.
 *
 * The comment feed renders under `/audits/:auditId/activity`, a route with no
 * action. A form that names no action posts to the page it is on, so the delete
 * has to name the note route — otherwise it lands on the parent audit route,
 * which reads an `intent` the form never sends.
 *
 * @see {@link file://./../../../../app/components/audit/notes/actions-dropdown.tsx}
 */
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ActionsDropdown } from "~/components/audit/notes/actions-dropdown";

// why: the menu content only mounts once a pointer opens it, which happy-dom
// cannot drive reliably. Rendering the items inline keeps the form assertable.
vi.mock("~/components/shared/dropdown", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// why: `useFetcher` needs a data router to submit; the form's attributes are
// what is under test, so it renders as a plain form.
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => ({
      Form: ({ children, ...props }: { children: ReactNode }) => (
        <form {...props}>{children}</form>
      ),
    }),
  };
});

describe("audit comment actions", () => {
  it("posts the delete to the audit's note route, not the activity page", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/audits/audit-1/activity"]}>
        <Routes>
          <Route
            path="/audits/:auditId/activity"
            element={<ActionsDropdown noteId="note-1" />}
          />
        </Routes>
      </MemoryRouter>
    );

    const form = container.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/audits/audit-1/note");
    expect(form?.getAttribute("method")).toBe("delete");
    expect(
      container.querySelector('input[name="noteId"]')?.getAttribute("value")
    ).toBe("note-1");
  });
});
