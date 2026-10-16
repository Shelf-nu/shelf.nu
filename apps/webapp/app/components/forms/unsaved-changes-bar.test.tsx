import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { UnsavedChangesState } from "~/hooks/use-unsaved-changes";
import { UnsavedChangesBar } from "./unsaved-changes-bar";

/** Renders the bar inside a data router, which `useDisabled` needs. */
function renderBar(state: UnsavedChangesState) {
  const onDiscard = vi.fn();
  const onSave = vi.fn();
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <main>
          <UnsavedChangesBar
            state={state}
            onDiscard={onDiscard}
            onSave={onSave}
          />
        </main>
      ),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  return { onDiscard, onSave };
}

describe("UnsavedChangesBar", () => {
  it("renders nothing on a clean form", () => {
    renderBar({ status: "clean" });
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves and discards through its callbacks", async () => {
    const { onDiscard, onSave } = renderBar({ status: "dirty" });
    await screen.findByText("Unsaved changes");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("reads Saving... and disables both buttons while submitting", async () => {
    renderBar({ status: "submitting" });
    expect(await screen.findAllByText("Saving...")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("asks before leaving when a navigation is blocked", async () => {
    const proceed = vi.fn();
    const stay = vi.fn();
    renderBar({ status: "blocked", proceed, stay });

    await screen.findByText(
      "You have changes that are not saved. Leave this page and lose them?"
    );
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(stay).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Leave page" }));
    expect(proceed).toHaveBeenCalledTimes(1);
  });
});
