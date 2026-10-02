/**
 * The full-size image preview every thumbnail opens into, exercised through
 * `ImageWithPreview` the way audit photos use it.
 *
 * @see {@link file://./../../../app/components/image-with-preview/image-preview-dialog.tsx}
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { Sheet, SheetContent, SheetTitle } from "~/components/shared/sheet";

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
    await user.keyboard("{Escape}");
    expect(preview()).toBeNull();
  });

  it("locks the page scroll while open and releases it on close", async () => {
    const user = userEvent.setup();
    await user.click(renderThumbnail());

    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
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
    await user.keyboard("{ArrowRight}");
    expect(preview()?.querySelector("img")?.getAttribute("src")).toBe(
      second.imageUrl
    );
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("1 of 2 image(s)")).toBeTruthy();
  });

  it("takes taps even when a modal sheet has disabled them on the page", async () => {
    const user = userEvent.setup();
    await user.click(renderThumbnail());

    const backdrop = document.querySelector<HTMLElement>(
      "[data-image-preview-backdrop]"
    );
    expect(backdrop?.className).toContain("pointer-events-auto");
  });

  it("keeps Tab inside the preview and focuses the close button on open", async () => {
    const user = userEvent.setup();
    await user.click(renderThumbnail());

    const close = screen.getByRole("button", { name: "Close preview" });
    expect(document.activeElement).toBe(close);

    // Shift+Tab from the first control wraps to the last one inside the
    // preview, and Tab from there wraps back: focus never reaches the page.
    await user.tab({ shift: true });
    const last = document.activeElement as HTMLElement;
    expect(preview()?.contains(last)).toBe(true);
    expect(last).not.toBe(close);

    await user.tab();
    expect(document.activeElement).toBe(close);
  });

  it("takes focus and Escape from a sheet it opens from, then hands them back", async () => {
    const user = userEvent.setup();
    render(
      <Sheet open>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle>Booking assets</SheetTitle>
          <ImageWithPreview
            imageUrl={photo.imageUrl}
            thumbnailUrl={photo.thumbnailUrl}
            alt={photo.alt}
            withPreview
          />
        </SheetContent>
      </Sheet>
    );

    await user.click(
      screen.getByRole("button", { name: `Open preview for ${photo.alt}` })
    );
    const close = screen.getByRole("button", { name: "Close preview" });
    expect(document.activeElement).toBe(close);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Close preview" })).toBeNull();
    expect(screen.getByText("Booking assets")).toBeTruthy();
  });
});
