/**
 * The body of the Reserve button's tooltip when unavailable assets block it.
 *
 * Rendered on its own rather than through `EditBookingForm`, which needs route
 * loader data and half a dozen hooks to mount. What matters here is what an
 * operator reads when Reserve refuses them, and that is entirely this
 * component's job.
 *
 * @see {@link file://./edit-booking-form.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { UnavailableAssetRow } from "~/modules/booking/unavailable-assets";
import { UnavailableAssetsReason } from "./edit-booking-form";

function asset(
  id: string,
  title: string,
  kitName: string | null = null
): UnavailableAssetRow {
  return { id, title, kitName };
}

describe("UnavailableAssetsReason", () => {
  it("keeps the shared refusal sentence", () => {
    render(
      <UnavailableAssetsReason assets={[asset("a1", "Barndoors", "Kit A")]} />
    );

    expect(
      screen.getByText(/holds assets marked as unavailable/i)
    ).toBeInTheDocument();
  });

  it("names an asset and the kit it sits in", () => {
    render(
      <UnavailableAssetsReason
        assets={[asset("a1", "Barndoors", "Aputure 120d II Kit 02")]}
      />
    );

    expect(screen.getByText("Barndoors")).toBeInTheDocument();
    expect(
      screen.getByText(/in kit Aputure 120d II Kit 02/)
    ).toBeInTheDocument();
  });

  /**
   * An asset booked in its own right has no kit to point at, and " in kit "
   * with nothing after it would read as a missing value rather than an absent
   * one.
   */
  it("says nothing about a kit for a standalone asset", () => {
    render(<UnavailableAssetsReason assets={[asset("a1", "Tripod")]} />);

    expect(screen.getByText("Tripod")).toBeInTheDocument();
    expect(screen.queryByText(/in kit/)).not.toBeInTheDocument();
  });

  /**
   * A hover card that runs past the bottom of the screen answers nothing, so
   * the list stops and counts the rest. The count has to be the remainder, not
   * the total, or it reads as "and 8 more" beneath a list of all eight.
   */
  it("stops at five and counts the remainder", () => {
    const assets = Array.from({ length: 8 }, (_, i) =>
      asset(`a${i}`, `Asset ${i}`)
    );

    render(<UnavailableAssetsReason assets={assets} />);

    expect(screen.getByText("Asset 4")).toBeInTheDocument();
    expect(screen.queryByText("Asset 5")).not.toBeInTheDocument();
    expect(screen.getByText("and 3 more")).toBeInTheDocument();
  });

  it("does not count a remainder when everything fits", () => {
    const assets = Array.from({ length: 5 }, (_, i) =>
      asset(`a${i}`, `Asset ${i}`)
    );

    render(<UnavailableAssetsReason assets={assets} />);

    expect(screen.getByText("Asset 4")).toBeInTheDocument();
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });

  /**
   * The flag can clear between the loader resolving and this rendering, and an
   * empty list must not leave a bare bullet under the sentence.
   */
  it("renders the sentence alone when the list is empty", () => {
    render(<UnavailableAssetsReason assets={[]} />);

    expect(
      screen.getByText(/holds assets marked as unavailable/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
