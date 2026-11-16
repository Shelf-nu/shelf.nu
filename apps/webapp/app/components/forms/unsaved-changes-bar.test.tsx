import { useRef } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRoutesStub, Form, useActionData } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnsavedChangesState } from "~/hooks/use-unsaved-changes";
import { UnsavedChangesBar, UnsavedChangesGuard } from "./unsaved-changes-bar";

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

  it("leaves without also cancelling the navigation", async () => {
    const proceed = vi.fn();
    const stay = vi.fn();
    renderBar({ status: "blocked", proceed, stay });

    fireEvent.click(await screen.findByRole("button", { name: "Leave page" }));

    expect(proceed).toHaveBeenCalledTimes(1);
    expect(stay).not.toHaveBeenCalled();
  });
});

/** A form that routes on `intent`, like the booking edit form. */
function IntentForm({ saveDisabled }: { saveDisabled: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const actionData = useActionData<{ intent: string }>();
  return (
    <main>
      <UnsavedChangesGuard
        formRef={formRef}
        actionData={actionData}
        onDiscard={() => {}}
        getSubmitter={() => saveRef.current}
        saveDisabled={saveDisabled}
      />
      <Form ref={formRef} method="post">
        <input aria-label="Name" name="name" defaultValue="Field day" />
        <button
          ref={saveRef}
          type="submit"
          name="intent"
          value="save"
          disabled={saveDisabled}
        >
          Header save
        </button>
      </Form>
      <p data-testid="intent">{actionData?.intent ?? ""}</p>
    </main>
  );
}

function renderGuard(saveDisabled: boolean) {
  // why: a pass-through spy, so the test can wait for the frame in which the
  // guard reads its baseline instead of counting frames
  const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
  const action = vi.fn(async ({ request }: { request: Request }) => ({
    intent: String((await request.formData()).get("intent")),
  }));
  const Stub = createRoutesStub([
    {
      path: "/booking",
      Component: () => <IntentForm saveDisabled={saveDisabled} />,
      action,
    },
  ]);
  render(<Stub initialEntries={["/booking"]} />);
  return { action, rafSpy };
}

afterEach(() => vi.restoreAllMocks());

/**
 * Types into Name once the baseline exists and waits for the bar.
 *
 * @param rafSpy - The spy from `renderGuard`; its first call is the baseline
 * frame, and frames run in the order they were requested
 */
async function editName(rafSpy: { mock: { calls: unknown[] } }) {
  const name = await screen.findByLabelText("Name");
  await waitFor(() => expect(rafSpy.mock.calls.length).toBeGreaterThan(0));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  fireEvent.change(name, { target: { value: "Field day 2" } });
  return screen.findByRole(
    "region",
    { name: "Unsaved changes" },
    {
      timeout: 3000,
    }
  );
}

describe("UnsavedChangesGuard", () => {
  it("saves through the form's submitter so its intent is sent", async () => {
    const { action, rafSpy } = renderGuard(false);
    const bar = await editName(rafSpy);

    fireEvent.click(within(bar).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByTestId("intent")).toHaveTextContent("save")
    );
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("disables Save while the form's own Save is disabled", async () => {
    const { action, rafSpy } = renderGuard(true);
    const bar = await editName(rafSpy);

    const save = within(bar).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(action).not.toHaveBeenCalled();
  });
});
