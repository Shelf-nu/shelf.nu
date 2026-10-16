/**
 * The previous/next arrows in a detail page header, with the hook that feeds
 * them. Rendered in a router stub whose neighbours endpoint is a stub loader,
 * so the history state, the load and the keyboard all run for real.
 *
 * @see {@link file://./record-navigation.tsx}
 * @see {@link file://../../../hooks/use-list-context.ts}
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRoutesStub,
  Link,
  Outlet,
  useLocation,
  useParams,
} from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecordNavigation } from "~/hooks/use-list-context";
import type { Neighbours } from "~/modules/list-navigation/list-context";
import { NO_LIST_CONTEXT_REASON, RecordNavigation } from "./record-navigation";

const neighboursLoader = vi.fn();

/** Neighbours per record id, as the endpoint would answer them. */
const NEIGHBOURS: Record<string, Neighbours> = {
  a2: { prev: { id: "a1", page: 1 }, next: { id: "a3", page: 2 } },
  a3: { prev: { id: "a2", page: 1 }, next: null },
};

/** A stand-in asset page: the arrows, a field, and where we are. */
function AssetPage() {
  const { assetId } = useParams();
  const location = useLocation();
  const navigation = useRecordNavigation({ entity: "asset", id: assetId! });
  return (
    <div>
      <RecordNavigation navigation={navigation} />
      <Link to="activity">Activity</Link>
      <Link to="/assets/a3/overview">Unrelated link to a3</Link>
      <input aria-label="Search activity" />
      <p data-testid="where">{location.pathname}</p>
      <p data-testid="context">
        {JSON.stringify(location.state?.listContext ?? null)}
      </p>
      <Outlet />
    </div>
  );
}

function renderAt(entry: { pathname: string; state?: unknown }) {
  const Stub = createRoutesStub([
    {
      path: "/assets/:assetId",
      Component: AssetPage,
      children: [
        { path: "overview", Component: () => null },
        { path: "activity", Component: () => null },
      ],
    },
    { path: "/api/list-neighbours", loader: neighboursLoader },
  ]);
  return render(<Stub initialEntries={[entry]} />);
}

const FROM_LIST = {
  listContext: { entity: "asset", search: "?s=drill&page=1" },
};

describe("RecordNavigation", () => {
  beforeEach(() => {
    neighboursLoader.mockReset();
    neighboursLoader.mockImplementation(({ request }: { request: Request }) => {
      const id = new URL(request.url).searchParams.get("id") ?? "";
      return { ...NEIGHBOURS[id], error: null };
    });
  });

  it("disables both arrows and loads nothing when the page was not opened from a list", async () => {
    renderAt({ pathname: "/assets/a2/overview" });

    const prev = await screen.findByRole("button", {
      name: "Previous in list",
    });
    const next = screen.getByRole("button", { name: "Next in list" });
    expect(prev).toHaveAttribute("aria-disabled", "true");
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText(NO_LIST_CONTEXT_REASON).length).toBeGreaterThan(
      0
    );
    expect(neighboursLoader).not.toHaveBeenCalled();
  });

  it("enables the arrows once the neighbours arrive, and disables the one past the end", async () => {
    renderAt({ pathname: "/assets/a3/overview", state: FROM_LIST });

    const prev = screen.getByRole("button", { name: "Previous in list" });
    await waitFor(() => expect(prev).toBeEnabled());
    expect(screen.getByRole("button", { name: "Next in list" })).toBeDisabled();

    const url = new URL(neighboursLoader.mock.calls[0][0].request.url);
    expect(url.searchParams.get("entity")).toBe("asset");
    expect(url.searchParams.get("id")).toBe("a3");
    expect(url.searchParams.get("filters")).toBe("s=drill&page=1");
  });

  it("steps to the next record on ] and carries the list context with its page", async () => {
    const user = userEvent.setup();
    renderAt({ pathname: "/assets/a2/overview", state: FROM_LIST });
    const next = screen.getByRole("button", { name: "Next in list" });
    await waitFor(() => expect(next).toBeEnabled());

    await user.keyboard("]");

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/assets/a3/overview"
      )
    );
    expect(JSON.parse(screen.getByTestId("context").textContent!)).toEqual({
      entity: "asset",
      search: "?s=drill&page=2",
    });
  });

  it("ignores ] while the user types in a field", async () => {
    const user = userEvent.setup();
    renderAt({ pathname: "/assets/a2/overview", state: FROM_LIST });
    const next = screen.getByRole("button", { name: "Next in list" });
    await waitFor(() => expect(next).toBeEnabled());

    await user.click(screen.getByRole("textbox", { name: "Search activity" }));
    await user.keyboard("]");

    expect(screen.getByTestId("where")).toHaveTextContent(
      "/assets/a2/overview"
    );
    expect(
      screen.getByRole("textbox", { name: "Search activity" })
    ).toHaveValue("]");
  });

  it("keeps the arrows on a tab switch inside the same record, but not on another record", async () => {
    const user = userEvent.setup();
    renderAt({ pathname: "/assets/a2/overview", state: FROM_LIST });
    const next = screen.getByRole("button", { name: "Next in list" });
    await waitFor(() => expect(next).toBeEnabled());

    await user.click(screen.getByRole("link", { name: "Activity" }));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/assets/a2/activity"
      )
    );
    expect(screen.getByRole("button", { name: "Next in list" })).toBeEnabled();

    await user.click(
      screen.getByRole("link", { name: "Unrelated link to a3" })
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Next in list" })
      ).toHaveAttribute("aria-disabled", "true")
    );
  });
});
