import { useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createRoutesStub,
  Form,
  Link,
  Outlet,
  redirect,
  useActionData,
  useLocation,
  useNavigation,
} from "react-router";
import { describe, expect, it } from "vitest";
import {
  serializeFormSnapshot,
  UNSAVED_CHANGES_DEFAULT_IGNORE,
  useUnsavedChanges,
} from "./use-unsaved-changes";

/** Lets a test change a hidden input with no DOM event, as widgets do. */
let setHiddenValue: (value: string) => void = () => {};

function EditForm({ onDiscard }: { onDiscard: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [hidden, setHidden] = useState("drills");
  setHiddenValue = setHidden;
  const actionData = useActionData<{ ok?: boolean; error?: unknown }>();
  const { search } = useLocation();
  const { state, discard } = useUnsavedChanges({
    formRef,
    actionData,
    onDiscard,
  });

  return (
    <Form ref={formRef} method="post">
      <input
        aria-label="Name"
        name="title"
        defaultValue="Makita drill"
        disabled={useNavigation().state !== "idle"}
      />
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
      <Link to="?slow=1">Slow reload</Link>
      <Link to="/edit/child">Open child</Link>
      <Outlet />
    </Form>
  );
}

/** Keys the form so Discard remounts it, the way the real forms do. */
function EditPage() {
  const [epoch, setEpoch] = useState(0);
  return <EditForm key={epoch} onDiscard={() => setEpoch((e) => e + 1)} />;
}

function renderForm(action: () => unknown = () => ({ ok: true })) {
  const Stub = createRoutesStub([
    {
      path: "/edit",
      Component: EditPage,
      action,
      // why: a slow reload keeps the navigation (and the disabled input)
      // around long enough for the interval check to run during it
      loader: async ({ request }) => {
        if (new URL(request.url).searchParams.has("slow")) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        return null;
      },
      children: [
        {
          path: "child",
          Component: () => (
            <div>
              <p>Child modal</p>
              <Link to="/edit">Close child</Link>
            </div>
          ),
        },
      ],
    },
    { path: "/other", Component: () => <p>Other page loaded</p> },
  ]);
  render(<Stub initialEntries={["/edit"]} />);
}

const status = () => screen.getByTestId("status").textContent;

async function makeDirtyByTyping() {
  // why: the baseline is taken one frame after mount; two frames make sure
  // it exists before the change, even on a loaded machine
  await waitFor(() => expect(status()).toBe("clean"));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Makita drill 18V" },
  });
  // why: under a full validate run frames and the 1 s interval arrive late
  await waitFor(() => expect(status()).toBe("dirty"), { timeout: 3000 });
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

  it("stays dirty after a save the server rejects", async () => {
    renderForm(() => ({ error: { message: "Name is required" } }));
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
    // why: a wrongly re-taken baseline lands a frame after the submit
    // settles, and React renders it later still
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(status()).toBe("dirty");
    expect(screen.getByLabelText("Name")).toHaveValue("Makita drill 18V");
  });

  it("is clean after a save that redirects back to the same page", async () => {
    renderForm(() => redirect("/edit"));
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(status()).toBe("clean"));
    expect(screen.getByLabelText("Name")).toHaveValue("Makita drill 18V");
  });

  it("does not block opening or closing a child route of the form's page", async () => {
    renderForm();
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("link", { name: "Open child" }));
    await screen.findByText("Child modal");
    fireEvent.click(screen.getByRole("link", { name: "Close child" }));
    await waitFor(() =>
      expect(screen.queryByText("Child modal")).not.toBeInTheDocument()
    );
    expect(status()).toBe("dirty");
    expect(screen.getByLabelText("Name")).toHaveValue("Makita drill 18V");
  });

  it("asks the browser to confirm closing the tab only while dirty", async () => {
    renderForm();
    await waitFor(() => expect(status()).toBe("clean"));
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);

    await makeDirtyByTyping();
    const dirtyUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
  });

  it("stays clean while a navigation disables the inputs", async () => {
    renderForm();
    await waitFor(() => expect(status()).toBe("clean"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent.click(screen.getByRole("link", { name: "Slow reload" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(status()).toBe("clean");
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled(), {
      timeout: 2000,
    });
    expect(status()).toBe("clean");
  });
});

describe("serializeFormSnapshot", () => {
  /** Builds a detached form with the given hidden fields. */
  function formWith(fields: Record<string, string>) {
    const form = document.createElement("form");
    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
    return form;
  }

  const ignored = new Set([...UNSAVED_CHANGES_DEFAULT_IGNORE, "extra"]);

  it("leaves out the steering fields and the caller's ignored names", () => {
    const before = formWith({
      title: "Drill",
      redirectTo: "/assets",
      intent: "save",
      addAnother: "false",
      nameChangeOnly: "false",
      extra: "a",
    });
    const after = formWith({
      title: "Drill",
      redirectTo: "/kits",
      intent: "reserve",
      addAnother: "true",
      nameChangeOnly: "true",
      extra: "b",
    });
    expect(serializeFormSnapshot(after, ignored)).toBe(
      serializeFormSnapshot(before, ignored)
    );
  });

  it("differs when a submitted value changes", () => {
    expect(
      serializeFormSnapshot(formWith({ title: "Drill" }), ignored)
    ).not.toBe(serializeFormSnapshot(formWith({ title: "Saw" }), ignored));
  });
});
