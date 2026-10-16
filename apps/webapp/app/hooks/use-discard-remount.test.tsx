import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { useDiscardRemount } from "./use-discard-remount";

function Page() {
  const { key, discard, discarded } = useDiscardRemount();
  return (
    <>
      <span data-testid="key">{key}</span>
      <span data-testid="discarded">{String(discarded)}</span>
      <button type="button" onClick={discard}>
        Discard
      </button>
    </>
  );
}

function renderPage() {
  const Stub = createRoutesStub([{ path: "/edit", Component: Page }]);
  render(
    <Provider>
      <Stub initialEntries={["/edit"]} />
    </Provider>
  );
}

describe("useDiscardRemount", () => {
  it("reports a fresh mount until the first Discard", async () => {
    renderPage();
    expect(await screen.findByTestId("discarded")).toHaveTextContent("false");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(await screen.findByText("true")).toBeInTheDocument();
    expect(screen.getByTestId("key")).toHaveTextContent("1");
  });
});
