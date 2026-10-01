/**
 * The full-size image preview every thumbnail opens into, exercised through
 * `ImageWithPreview` the way audit photos use it.
 *
 * @see {@link file://./../../../app/components/image-with-preview/image-preview-dialog.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";

const photo = {
  id: "image-1",
  imageUrl: "https://storage.test/audits/photo.webp",
  thumbnailUrl: "https://storage.test/audits/photo-thumbnail.webp",
  alt: "Photo of Libec LX-7 Tripod",
};

function renderThumbnail(images?: (typeof photo)[]) {
  render(
    <ImageWithPreview
      imageUrl={photo.imageUrl}
      thumbnailUrl={photo.thumbnailUrl}
      alt={photo.alt}
      withPreview
      images={images}
      currentImageId={photo.id}
    />
  );
  return screen.getByRole("button", { name: `Open preview for ${photo.alt}` });
}

const preview = () => screen.queryByRole("dialog");

describe("image preview", () => {
  it("opens the full image, not the thumbnail, when the thumbnail is clicked", async () => {
    const user = userEvent.setup();
    await user.click(renderThumbnail());

    const dialog = preview();
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector("img")?.getAttribute("src")).toBe(
      photo.imageUrl
    );
  });

  it("closes on a tap around the image but not on the image itself", async () => {
    const user = userEvent.setup();
    await user.click(renderThumbnail());

    await user.click(preview()!.querySelector("img")!);
    expect(preview()).not.toBeNull();

    const stage = document.querySelector<HTMLElement>(
      "[data-image-preview-stage]"
    );
    await user.click(stage!);
    expect(preview()).toBeNull();
  });

  it("closes on a tap on the backdrop", async () => {
    const user = userEvent.setup();
    await user.click(renderThumbnail());

    await user.click(
      document.querySelector<HTMLElement>("[data-image-preview-backdrop]")!
    );
    expect(preview()).toBeNull();
  });

  it("closes on the close button and on Escape", async () => {
    const user = userEvent.setup();
    const thumbnail = renderThumbnail();

    await user.click(thumbnail);
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(preview()).toBeNull();

    await user.click(thumbnail);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(preview()).toBeNull();
  });

  it("locks the page scroll while open and restores it on close", async () => {
    const user = userEvent.setup();
    document.body.style.overflow = "auto";
    await user.click(renderThumbnail());

    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(document.body.style.overflow).toBe("auto");
  });

  it("pages through a set with the arrow keys", async () => {
    const user = userEvent.setup();
    const second = {
      id: "image-2",
      imageUrl: "https://storage.test/audits/second.webp",
      thumbnailUrl: "https://storage.test/audits/second-thumbnail.webp",
      alt: "Second photo",
    };
    await user.click(renderThumbnail([photo, second]));

    expect(screen.getByText("1 of 2 image(s)")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(preview()?.querySelector("img")?.getAttribute("src")).toBe(
      second.imageUrl
    );
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("1 of 2 image(s)")).toBeTruthy();
  });
});
