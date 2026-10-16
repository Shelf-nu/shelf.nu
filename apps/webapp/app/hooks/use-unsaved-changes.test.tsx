import { useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createRoutesStub,
  Form,
  Link,
  useActionData,
  useLocation,
} from "react-router";
import { describe, expect, it } from "vitest";
import { useUnsavedChanges } from "./use-unsaved-changes";

/** Lets a test change a hidden input with no DOM event, as widgets do. */
let setHiddenValue: (value: string) => void = () => {};

function EditForm({ onDiscard }: { onDiscard: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [hidden, setHidden] = useState("drills");
  setHiddenValue = setHidden;
  const actionData = useActionData<{ ok: boolean }>();
  const { search } = useLocation();
  const { state, discard } = useUnsavedChanges({
    formRef,
    savedToken: actionData,
    onDiscard,
  });

  return (
    <Form ref={formRef} method="post">
      <input aria-label="Name" name="title" defaultValue="Makita drill" />
      <input type="hidden" name="tags" value={hidden} />
      <input type="hidden" name="redirectTo" value="/assets" />
      <span data-testid="status">{state.status}</span>
      <span data-testid="query">
        {new URLSearchParams(search).get("q") ?? ""}
      </span>
      <button type="button" onClick={discard}>
        Discard
      </button>
      <button type="submit">Save</button>
      {state.status === "blocked" ? (
        <>
          <button type="button" onClick={state.proceed}>
            Leave page
          </button>
          <button type="button" onClick={state.stay}>
            Stay
          </button>
        </>
      ) : null}
      <Link to="/other">Other page</Link>
      <Link to="?q=1">Same page</Link>
    </Form>
  );
}

/** Keys the form so Discard remounts it, the way the real forms do. */
function EditPage() {
  const [epoch, setEpoch] = useState(0);
  return <EditForm key={epoch} onDiscard={() => setEpoch((e) => e + 1)} />;
}

function renderForm() {
  const Stub = createRoutesStub([
    {
      path: "/edit",
      Component: EditPage,
      action: () => ({ ok: true }),
    },
    { path: "/other", Component: () => <p>Other page loaded</p> },
  ]);
  render(<Stub initialEntries={["/edit"]} />);
}

const status = () => screen.getByTestId("status").textContent;

async function makeDirtyByTyping() {
  // why: the baseline is taken one frame after mount
  await waitFor(() => expect(status()).toBe("clean"));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Makita drill 18V" },
  });
  await waitFor(() => expect(status()).toBe("dirty"));
}

describe("useUnsavedChanges", () => {
  it("turns dirty when the user types", async () => {
    renderForm();
    await makeDirtyByTyping();
  });

  it("picks up a hidden input changed with no DOM event", async () => {
    renderForm();
    await waitFor(() => expect(status()).toBe("clean"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    setHiddenValue("drills,cordless");
    await waitFor(() => expect(status()).toBe("dirty"), { timeout: 2000 });
  });

  it("is clean again after discard, with the loaded values back", async () => {
    renderForm();
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(status()).toBe("clean"));
    expect(screen.getByLabelText("Name")).toHaveValue("Makita drill");
  });

  it("blocks leaving for another page until the user proceeds", async () => {
    renderForm();
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("link", { name: "Other page" }));
    await waitFor(() => expect(status()).toBe("blocked"));
    expect(screen.queryByText("Other page loaded")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Leave page" }));
    await screen.findByText("Other page loaded");
  });

  it("keeps the change when the user stays", async () => {
    renderForm();
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("link", { name: "Other page" }));
    await waitFor(() => expect(status()).toBe("blocked"));
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(status()).toBe("dirty"));
    expect(screen.getByLabelText("Name")).toHaveValue("Makita drill 18V");
  });

  it("does not block a navigation on the same pathname", async () => {
    renderForm();
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("link", { name: "Same page" }));
    await waitFor(() =>
      expect(screen.getByTestId("query")).toHaveTextContent("1")
    );
    expect(status()).toBe("dirty");
  });

  it("does not block its own submit and is clean after a successful save", async () => {
    renderForm();
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(status()).toBe("clean"));
    expect(screen.getByLabelText("Name")).toHaveValue("Makita drill 18V");
  });
});
