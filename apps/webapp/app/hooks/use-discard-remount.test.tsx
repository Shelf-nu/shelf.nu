import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import { createRoutesStub, Link, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { useDiscardRemount } from "./use-discard-remount";

function Page() {
  const { key, discard, discarded } = useDiscardRemount();
  const { search } = useLocation();
  return (
    <>
      <span data-testid="key">{key}</span>
      <span data-testid="search">{search}</span>
      <Link to="?category=tools">Pick model</Link>
      <span data-testid="discarded">{String(discarded)}</span>
      <button type="button" onClick={discard}>
        Discard
      </button>
    </>
  );
}

function renderPage(initialEntry = "/edit") {
  const Stub = createRoutesStub([{ path: "/edit", Component: Page }]);
  render(
    <Provider>
      <Stub initialEntries={[initialEntry]} />
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

  it("puts back the query string a picker rewrote before remounting", async () => {
    renderPage("/edit?ref=list");
    fireEvent.click(await screen.findByRole("link", { name: "Pick model" }));
    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent("?category=tools")
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() =>
      expect(screen.getByTestId("key")).toHaveTextContent("1")
    );
    expect(screen.getByTestId("search")).toHaveTextContent("?ref=list");
  });
});
