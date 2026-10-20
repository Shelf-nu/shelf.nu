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
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  serializeFormSnapshot,
  UNSAVED_CHANGES_DEFAULT_IGNORE,
  useUnsavedChanges,
} from "./use-unsaved-changes";

/** Lets a test change a hidden input with no DOM event, as widgets do. */
let setHiddenValue: (value: string) => void = () => {};

function EditForm({
  onDiscard,
  saveIntents,
}: {
  onDiscard: () => void;
  saveIntents?: string[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [hidden, setHidden] = useState("drills");
  setHiddenValue = setHidden;
  const actionData = useActionData<{ ok?: boolean; error?: unknown }>();
  const { search } = useLocation();
  const { state, discard } = useUnsavedChanges({
    formRef,
    actionData,
    onDiscard,
    saveIntents,
  });

  return (
    <>
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
        <button type="submit" name="intent" value="save">
          Save
        </button>
        <button type="submit" name="intent" value="checkOut">
          Check out
        </button>
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
      {/* Another form on the same page, like a booking's remove-asset row. */}
      <Form method="post">
        <input type="hidden" name="assetId" value="asset-1" />
        <button type="submit" name="intent" value="removeAsset">
          Remove asset
        </button>
      </Form>
    </>
  );
}

/** Keys the form so Discard remounts it, the way the real forms do. */
function EditPage({ saveIntents }: { saveIntents?: string[] }) {
  const [epoch, setEpoch] = useState(0);
  return (
    <EditForm
      key={epoch}
      onDiscard={() => setEpoch((e) => e + 1)}
      saveIntents={saveIntents}
    />
  );
}

function renderForm(
  action: () => unknown = () => ({ ok: true }),
  saveIntents?: string[]
) {
  const Stub = createRoutesStub([
    {
      path: "/edit",
      Component: () => <EditPage saveIntents={saveIntents} />,
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

let rafSpy: MockInstance<typeof requestAnimationFrame>;
beforeEach(() => {
  // why: a pass-through spy. The hook schedules its baseline read with
  // requestAnimationFrame once the routed form mounts, which happens outside
  // act(), so the tests wait for that call instead of counting frames.
  rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
});
afterEach(() => rafSpy.mockRestore());

/** Resolves once the hook has read its baseline snapshot. */
async function waitForBaseline() {
  await waitFor(() => expect(status()).toBe("clean"));
  await waitFor(() => expect(rafSpy).toHaveBeenCalled());
  // why: frames run in the order they were requested, so this one runs
  // after the baseline frame
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

async function makeDirtyByTyping() {
  await waitForBaseline();
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
    await waitForBaseline();
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

  it("blocks a navigation started the moment the form shows dirty", async () => {
    renderForm();
    await waitForBaseline();
    // Click as soon as "dirty" reaches the DOM, before React runs the
    // commit's passive effects: the guard must already hold by then.
    const statusEl = screen.getByTestId("status");
    const observer = new MutationObserver(() => {
      if (statusEl.textContent !== "dirty") return;
      observer.disconnect();
      fireEvent.click(screen.getByRole("link", { name: "Other page" }));
    });
    observer.observe(statusEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Makita drill 18V" },
    });

    await waitFor(() => expect(status()).toBe("blocked"), { timeout: 3000 });
    expect(screen.queryByText("Other page loaded")).not.toBeInTheDocument();
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

  it("stays dirty when another form on the page saves", async () => {
    renderForm();
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("button", { name: "Remove asset" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
    // why: a wrongly re-taken baseline lands after the submit settles
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(status()).toBe("dirty");
  });

  it("stays dirty after its own submit with an intent that does not save it", async () => {
    renderForm(() => ({ ok: true }), ["save"]);
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(status()).toBe("dirty");
  });

  it("is clean after its own submit with a saving intent", async () => {
    renderForm(() => ({ ok: true }), ["save"]);
    await makeDirtyByTyping();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(status()).toBe("clean"));
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
    await waitForBaseline();
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
