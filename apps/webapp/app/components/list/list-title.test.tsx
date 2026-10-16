/**
 * ListTitle count line — unit tests
 *
 * The count line mixes two numbers that are not always the same unit: what
 * `countLabel` says, and `totalItems`, which counts rendered rows. Pinning the
 * two shapes here because nothing else can catch them: both render a plausible
 * sentence, and only a reader who knows what the list contains can tell that
 * "3 asset models out of 4" describes four rows of which one is not a model.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ListTitle from "./list-title";

// why: ListTitle reads the list payload straight from the route loader, so a
// router context would have to serve a whole index loader to render one line.
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useLoaderData: () => ({
      items: [{ id: "a" }, { id: "b" }],
      totalItems: 4,
      perPage: 2,
      modelName: { singular: "asset", plural: "assets" },
      search: null,
    }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

describe("ListTitle count line", () => {
  it("keeps the total suffix for a label that describes the page", () => {
    // why: the booking overview labels the rows in front of the reader
    // ("18 assets and 2 kits"). Dropping the suffix there hides that the list
    // has more pages, which is the one thing the line exists to say.
    render(
      <ListTitle
        title="Assets"
        hasBulkActions={false}
        countLabel={() => "1 asset and 1 kit"}
      />
    );

    expect(screen.getByText(/out of 4/)).toBeTruthy();
  });

  it("omits the total suffix for a label that is itself the total", () => {
    // why: the model view's label counts MODELS while `totalItems` counts
    // rendered rows, which include the "No model" bucket. Appending one to the
    // other produced "3 asset models out of 4" above two rows.
    render(
      <ListTitle
        title="Asset models"
        hasBulkActions={false}
        countLabel={() => "3 asset models"}
        countLabelIsTotal
      />
    );

    expect(screen.getByText("3 asset models")).toBeTruthy();
    expect(screen.queryByText(/out of/)).toBeNull();
  });
});
