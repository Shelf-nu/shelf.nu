import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { KitsListComponent } from "./kits-list-component";

/**
 * The payload `/api/kits` serialises, as the component receives it.
 *
 * `useApiQuery` casts the response to the component's `Kit` type without
 * validating it, so a route that stops sending a field hands the component
 * `undefined` and the compiler stays silent — the popover then dies on the
 * first property read, taking the whole activity page down with it. This
 * fixture is the contract between the two: change `app/routes/api+/kits.tsx`
 * and change it here.
 */
const apiKitsPayload = {
  kits: [
    {
      id: "kit-1",
      name: "Camera Kit",
      image: null,
      imageExpiration: null,
      assets: [
        {
          id: "asset-1",
          title: "Sony FX3",
          mainImage: null,
          mainImageExpiration: null,
          thumbnailImage: null,
          imageSource: "placeholder",
          category: { name: "Cameras" },
        },
      ],
    },
    {
      id: "kit-2",
      name: "Audio Kit",
      image: null,
      imageExpiration: null,
      assets: [],
    },
  ],
};

// why: the hook fetches in an effect; stubbing it keeps these tests on how the
// component renders a known payload rather than on network behaviour.
const { useApiQueryMock } = vi.hoisted(() => ({ useApiQueryMock: vi.fn() }));

vi.mock("~/hooks/use-api-query", () => ({ default: useApiQueryMock }));

// why: both image components open their own signed-URL refresh fetchers, which
// need a data-router context. They have their own tests; stubbing them keeps
// this one on the kit/asset list the popover builds.
vi.mock("~/components/kits/kit-image", () => ({
  default: ({ kit }: { kit: { alt: string } }) => <img alt={kit.alt} />,
}));
vi.mock("~/components/assets/asset-image/component", () => ({
  AssetImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

// why: `Button` renders a react-router `Link` for internal targets, which needs
// router context.
const renderComponent = (count: number, ids: string) =>
  render(
    <MemoryRouter>
      <KitsListComponent count={count} ids={ids} action="added" />
    </MemoryRouter>
  );

describe("KitsListComponent", () => {
  beforeEach(() => {
    useApiQueryMock.mockReturnValue({
      data: apiKitsPayload,
      isLoading: false,
      error: undefined,
      refetch: vi.fn(),
    });
  });

  it("renders the kit count trigger for a multi-kit note", () => {
    renderComponent(2, "kit-1,kit-2");

    expect(screen.getByRole("button", { name: "2 kits" })).toBeVisible();
  });

  it("lists every kit with its member assets when opened", async () => {
    const user = userEvent.setup();
    renderComponent(2, "kit-1,kit-2");

    await user.click(screen.getByRole("button", { name: "2 kits" }));

    expect(await screen.findByText("Camera Kit")).toBeVisible();
    expect(screen.getByText("Audio Kit")).toBeVisible();
    expect(screen.getByText("Sony FX3")).toBeVisible();
    expect(screen.getByText("(Cameras)")).toBeVisible();
  });

  it("counts each kit's member assets", async () => {
    const user = userEvent.setup();
    renderComponent(2, "kit-1,kit-2");

    await user.click(screen.getByRole("button", { name: "2 kits" }));

    expect(await screen.findByText("(1 assets)")).toBeVisible();
    expect(screen.getByText("(0 assets)")).toBeVisible();
  });

  it("links straight to the kit for a single-kit note", () => {
    renderComponent(1, "kit-1");

    expect(screen.getByRole("link", { name: "Camera Kit" })).toHaveAttribute(
      "href",
      "/kits/kit-1"
    );
  });

  it("renders the trigger without member data before the popover is opened", () => {
    // The popover's children are built during this component's own render, so
    // an unopened popover still evaluates them — a payload it cannot read
    // crashes the page without anyone clicking.
    useApiQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
      refetch: vi.fn(),
    });

    renderComponent(3, "kit-1,kit-2,kit-3");

    expect(screen.getByRole("button", { name: "3 kits" })).toBeVisible();
  });
});
