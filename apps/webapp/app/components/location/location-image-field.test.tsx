/**
 * <LocationImageField> - unit tests
 *
 * Covers which picture the location form shows next to its "Main image"
 * input: the saved thumbnail, the full image when there is no thumbnail, the
 * placeholder for a location without an image, and a picked file's preview.
 * Preview and validation details are covered by the shared field's tests.
 *
 * @see {@link file://./location-image-field.tsx}
 * @see {@link file://../forms/image-file-field.test.tsx}
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationImageField } from "./location-image-field";

const IMAGE_URL = "https://storage.example.com/locations/loc_1/full.jpg";
const THUMBNAIL_URL = "https://storage.example.com/locations/loc_1/thumb.jpg";

/** Renders the field in its own jotai store so validation state never leaks. */
function renderField(props: Parameters<typeof LocationImageField>[0] = {}) {
  return render(
    <Provider store={createStore()}>
      <LocationImageField {...props} />
    </Provider>
  );
}

/**
 * The location picture next to the input (saved image or preview). Found by
 * alt text: a saved image that opens a preview has the button role.
 */
function picture() {
  return screen.getByAltText("Location image");
}

beforeEach(() => {
  // why: happy-dom does not implement object URLs.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-1");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LocationImageField", () => {
  it("shows the saved thumbnail, which opens the full image", () => {
    renderField({ imageUrl: IMAGE_URL, thumbnailUrl: THUMBNAIL_URL });

    expect(picture()).toHaveAttribute("src", THUMBNAIL_URL);
    expect(
      screen.getByRole("button", { name: "Open preview for Location image" })
    ).toBeInTheDocument();
  });

  it("falls back to the full image when there is no thumbnail", () => {
    renderField({ imageUrl: IMAGE_URL, thumbnailUrl: null });

    expect(picture()).toHaveAttribute("src", IMAGE_URL);
  });

  it("shows the placeholder for a location without an image", () => {
    renderField();

    expect(picture()).toHaveAttribute(
      "src",
      "/static/images/asset-placeholder.jpg"
    );
    // Nothing to open, so the placeholder is not a button.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("previews a picked file under the form's image field", async () => {
    const user = userEvent.setup();
    renderField({ imageUrl: IMAGE_URL, thumbnailUrl: THUMBNAIL_URL });
    const input = screen.getByLabelText("Main image") as HTMLInputElement;

    await user.upload(
      input,
      new File([new Uint8Array(1024)], "new.png", { type: "image/png" })
    );

    expect(picture()).toHaveAttribute("src", "blob:mock-1");
    expect(input.name).toBe("image");
  });
});
