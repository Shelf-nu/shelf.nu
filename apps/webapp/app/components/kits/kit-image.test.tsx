/**
 * <KitImage> - unit tests
 *
 * Covers which URL the kit picture shows and when its loading spinner clears:
 *  - the stored image while it is still valid, with no refresh request,
 *  - a refresh request for an expired stored image,
 *  - the refreshed URL over the expired stored one once it arrives,
 *  - the placeholder for a kit without an image,
 *  - the spinner clearing when the image fails to load, not only on load.
 *
 * @see {@link file://./kit-image.tsx}
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KitImage from "./kit-image";

const STORED_URL = "https://storage.example.com/kits/kit_1/stored.jpg";
const REFRESHED_URL = "https://storage.example.com/kits/kit_1/refreshed.jpg";

/** What the mocked fetcher returns; set per test before rendering. */
let fetcherData: unknown = undefined;
const submit = vi.fn();

// why: useFetcher needs a data router. The refresh round-trip is the action's
// concern; these tests only need to control what the fetcher hands back and
// see whether a refresh was requested.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({ state: "idle", data: fetcherData, submit }),
  };
});

/**
 * Renders a kit picture.
 *
 * @param image - Stored image URL, or null for a kit without one
 * @param imageExpiration - Expiry of the stored URL
 */
function renderKitImage(
  image: string | null,
  imageExpiration: Date | null = null
) {
  return render(
    <KitImage
      kit={{ kitId: "kit_1", image, imageExpiration, alt: "Kit image" }}
      className="size-16"
    />
  );
}

/** The kit picture's `<img>`. */
function picture() {
  return screen.getByAltText("Kit image");
}

const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2999-01-01T00:00:00Z");

beforeEach(() => {
  fetcherData = undefined;
  submit.mockReset();
  // why: the refresh request is delayed by a random jitter.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("KitImage", () => {
  it("shows a valid stored image without asking for a refresh", () => {
    renderKitImage(STORED_URL, FUTURE);

    act(() => {
      vi.runAllTimers();
    });

    expect(picture()).toHaveAttribute("src", STORED_URL);
    expect(submit).not.toHaveBeenCalled();
  });

  it("asks for a new URL when the stored one has expired", () => {
    renderKitImage(STORED_URL, PAST);

    act(() => {
      vi.runAllTimers();
    });

    expect(submit).toHaveBeenCalledWith(
      { kitId: "kit_1", image: STORED_URL },
      { method: "post", action: "/api/kit/refresh-image" }
    );
  });

  it("shows the refreshed URL instead of the expired stored one", () => {
    fetcherData = { error: null, kit: { image: REFRESHED_URL } };
    renderKitImage(STORED_URL, PAST);

    expect(picture()).toHaveAttribute("src", REFRESHED_URL);
  });

  it("keeps the stored image when the refresh fails", () => {
    fetcherData = { error: { message: "Cannot find kit filename" } };
    renderKitImage(STORED_URL, PAST);

    expect(picture()).toHaveAttribute("src", STORED_URL);
  });

  it("shows the placeholder for a kit without an image", () => {
    renderKitImage(null);

    expect(picture()).toHaveAttribute(
      "src",
      "/static/images/asset-placeholder.jpg"
    );
  });

  it("clears the loading spinner when the image fails to load", () => {
    const { container } = renderKitImage(STORED_URL, PAST);
    const spinnerOverlay = () => container.querySelector(".bg-gray-100");

    expect(spinnerOverlay()).not.toBeNull();

    fireEvent.error(picture());

    expect(spinnerOverlay()).toBeNull();
  });
});
