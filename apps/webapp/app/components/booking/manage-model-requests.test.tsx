/**
 * Behaviour of the booking Models tab: which controls each row offers, the
 * ceiling it enforces, and how searching and paging load other pages.
 *
 * Rendered inside a data router so the real fetchers run; the tab's page route
 * is a stub loader that records each request and answers with a fixed page.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type {
  ManageModelRequestsModel,
  ManageModelRequestsRequest,
  ModelTabPage,
} from "./manage-model-requests";
import { buildModelTabUrl, ManageModelRequests } from "./manage-model-requests";

/** A model with a free pool of 5 and nothing held by this booking. */
function model(
  id: string,
  overrides: Partial<ManageModelRequestsModel> = {}
): ManageModelRequestsModel {
  return {
    id,
    name: id,
    image: null,
    thumbnailImage: null,
    defaultCategory: null,
    namedNotInCustody: 0,
    total: 5,
    available: 5,
    reservedConcrete: 0,
    reservedViaRequest: 0,
    inCustody: 0,
    ...overrides,
  };
}

/** This booking's reservation of a model. */
function request(
  assetModelId: string,
  overrides: Partial<ManageModelRequestsRequest> = {}
): ManageModelRequestsRequest {
  return {
    assetModelId,
    assetModelName: assetModelId,
    quantity: 2,
    fulfilledQuantity: 0,
    fulfilledAt: null,
    ...overrides,
  };
}

/** A one-page result holding these models and reservations. */
function page(
  assetModels: ManageModelRequestsModel[],
  modelRequests: ManageModelRequestsRequest[] = [],
  extra: Partial<ModelTabPage> = {}
): ModelTabPage {
  return {
    assetModels,
    modelRequests,
    matchedAssetModels: assetModels.length,
    modelsPage: 1,
    modelsPerPage: 50,
    ...extra,
  };
}

/** Shows the dialog URL's query, which the tab must never change. */
function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

/**
 * Renders the tab with `initial` as the loader's first page. The page route
 * answers every load with `next` and records the query it was asked for.
 */
function renderTab(initial: ModelTabPage, next: ModelTabPage = initial) {
  const pageRequests: string[] = [];
  const pageLoader = vi.fn(({ request }: { request: Request }) => {
    pageRequests.push(new URL(request.url).search);
    return { error: null, ...next };
  });
  const Stub = createRoutesStub([
    {
      path: "/bookings/booking-1/overview/manage-assets",
      Component: () => (
        <>
          <ManageModelRequests bookingId="booking-1" {...initial} />
          <LocationProbe />
        </>
      ),
    },
    { path: "/api/bookings/:bookingId/model-tab", loader: pageLoader },
  ]);
  render(
    <Stub initialEntries={["/bookings/booking-1/overview/manage-assets"]} />
  );
  return { pageRequests };
}

/** The table row that names this model. */
const rowOf = (name: string) =>
  screen.getByText(name, { selector: "p" }).closest("tr") as HTMLElement;

describe("ManageModelRequests rows", () => {
  it("offers Add on a model this booking has not reserved", () => {
    renderTab(page([model("Dell")]));

    const row = within(rowOf("Dell"));
    expect(row.getByText("5 of 5 available")).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Reserve Dell" })).toBeEnabled();
  });

  it("offers Update and Remove on an open reservation nothing is assigned to", () => {
    renderTab(page([model("Dell")], [request("Dell")]));

    const row = within(rowOf("Dell"));
    expect(row.getByText("2 reserved")).toBeInTheDocument();
    expect(row.getByText("3 more available")).toBeInTheDocument();
    expect(
      row.getByRole("button", { name: "Update reservation for Dell" })
    ).toBeInTheDocument();
    expect(
      row.getByRole("button", { name: "Remove reservation for Dell" })
    ).toBeInTheDocument();
  });

  it("drops Remove once a unit is assigned", () => {
    renderTab(
      page(
        [model("Dell", { namedNotInCustody: 1 })],
        [request("Dell", { fulfilledQuantity: 1 })]
      )
    );

    const row = within(rowOf("Dell"));
    expect(row.getByText("2 reserved · 1 assigned")).toBeInTheDocument();
    expect(
      row.queryByRole("button", { name: "Remove reservation for Dell" })
    ).not.toBeInTheDocument();
  });

  it("shows a fulfilled reservation read-only", () => {
    renderTab(
      page(
        [model("Dell")],
        [
          request("Dell", {
            fulfilledQuantity: 2,
            fulfilledAt: "2026-11-01T00:00:00.000Z",
          }),
        ]
      )
    );

    const row = within(rowOf("Dell"));
    expect(row.getByText("Fulfilled")).toBeInTheDocument();
    expect(row.getByText("2 of 2 assigned")).toBeInTheDocument();
    expect(row.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables Add when the units held by name use up the pool", () => {
    // 2 free, 2 already held by name: the server would refuse any reservation.
    renderTab(page([model("Dell", { available: 2, namedNotInCustody: 2 })]));

    const row = within(rowOf("Dell"));
    expect(row.getByText("0 of 5 available")).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Reserve Dell" })).toBeDisabled();
  });

  it("flags a reservation larger than what the pool leaves it", () => {
    renderTab(page([model("Dell", { available: 1 })], [request("Dell")]));

    expect(
      within(rowOf("Dell")).getByText("Over-reserved")
    ).toBeInTheDocument();
  });
});

describe("ManageModelRequests loading", () => {
  it("loads a search from the tab route without touching the dialog URL", async () => {
    const user = userEvent.setup();
    const { pageRequests } = renderTab(
      page([model("Dell"), model("HP")]),
      page([model("Dell")])
    );

    await user.type(screen.getByLabelText("Search models"), "dell");

    await waitFor(() => expect(pageRequests).toEqual(["?modelSearch=dell"]));
    await waitFor(() =>
      expect(
        screen.queryByText("HP", { selector: "p" })
      ).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("location")).toHaveTextContent("");
  });

  it("loads the next page from the tab route", async () => {
    const user = userEvent.setup();
    const { pageRequests } = renderTab(
      page([model("Dell")], [], { matchedAssetModels: 60 }),
      page([model("Zebra")], [], { matchedAssetModels: 60, modelsPage: 2 })
    );

    await user.click(
      screen.getByRole("button", { name: "Next page of models" })
    );

    await waitFor(() => expect(pageRequests).toEqual(["?modelPage=2"]));
    expect(await screen.findByText("Zebra", { selector: "p" })).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("");
  });
});

describe("ManageModelRequests load errors", () => {
  it("keeps the last good page on screen beside the error", async () => {
    const user = userEvent.setup();
    const initial = page([model("Dell")], [], { matchedAssetModels: 60 });
    const pageTwo = page([model("Zebra")], [], {
      matchedAssetModels: 60,
      modelsPage: 2,
    });
    // First load answers page 2; every load after that fails.
    let calls = 0;
    const pageLoader = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? { error: null, ...pageTwo }
        : { error: { message: "Could not load models." } };
    });
    const Stub = createRoutesStub([
      {
        path: "/bookings/booking-1/overview/manage-assets",
        Component: () => (
          <ManageModelRequests bookingId="booking-1" {...initial} />
        ),
      },
      { path: "/api/bookings/:bookingId/model-tab", loader: pageLoader },
    ]);
    render(
      <Stub initialEntries={["/bookings/booking-1/overview/manage-assets"]} />
    );

    await user.click(
      screen.getByRole("button", { name: "Next page of models" })
    );
    expect(await screen.findByText("Zebra", { selector: "p" })).toBeVisible();

    await user.type(screen.getByLabelText("Search models"), "x");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load models."
    );
    // Page 2 stays, rather than the dialog loader's first page coming back.
    expect(screen.getByText("Zebra", { selector: "p" })).toBeVisible();
    expect(
      screen.queryByText("Dell", { selector: "p" })
    ).not.toBeInTheDocument();
  });
});

describe("buildModelTabUrl", () => {
  it("writes only the keys that differ from the first page", () => {
    expect(
      buildModelTabUrl("b-1", { search: "", page: 1, showEmpty: false })
    ).toBe("/api/bookings/b-1/model-tab");
    expect(
      buildModelTabUrl("b-1", { search: "dell", page: 2, showEmpty: true })
    ).toBe(
      "/api/bookings/b-1/model-tab?modelSearch=dell&modelPage=2&showEmptyModels=true"
    );
  });
});
