/**
 * <ImageFileField> - unit tests
 *
 * Covers what the user sees next to an image file input:
 *  - the saved image the caller passes in, until a file is picked,
 *  - a local preview of a picked file, before anything is uploaded,
 *  - the saved image again when the picked file fails validation (the
 *    validator clears the input, so nothing would be uploaded),
 *  - object URLs released when replaced and on unmount,
 *  - the field name, error and disabled state reaching the input.
 *
 * @see {@link file://./image-file-field.tsx}
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { ImageFileField } from "./image-file-field";

type FieldProps = Parameters<typeof ImageFileField>[0];

/** Renders the field in its own jotai store so validation state never leaks. */
function renderField(props: Partial<FieldProps> = {}) {
  return render(
    <Provider store={createStore()}>
      <ImageFileField
        name="image"
        label="Main image"
        previewAlt="Picked file"
        currentImage={<img src="/saved.png" alt="Saved logo" />}
        {...props}
      />
    </Provider>
  );
}

/** The file input, found by its (visually hidden) label. */
function fileInput() {
  return screen.getByLabelText("Main image") as HTMLInputElement;
}

/**
 * Builds a PNG `File` of a given byte size.
 *
 * @param name - File name (keep it clean so the validator does not rename it)
 * @param size - Size in bytes; above the 4 MB limit the validator rejects it
 */
function pngFile(name: string, size = 1024) {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

const TOO_BIG = DEFAULT_MAX_IMAGE_UPLOAD_SIZE + 1;
let objectUrlCount = 0;

beforeEach(() => {
  objectUrlCount = 0;
  // why: happy-dom does not implement object URLs.
  globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${++objectUrlCount}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImageFileField", () => {
  it("shows the saved image until a file is picked", () => {
    renderField();

    expect(screen.getByRole("img", { name: "Saved logo" })).toHaveAttribute(
      "src",
      "/saved.png"
    );
    expect(
      screen.queryByRole("img", { name: "Picked file" })
    ).not.toBeInTheDocument();
  });

  it("previews a picked file in place of the saved image", async () => {
    const user = userEvent.setup();
    renderField({ previewClassName: "size-12 rounded border" });
    const file = pngFile("new.png");

    await user.upload(fileInput(), file);

    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    const preview = screen.getByRole("img", { name: "Picked file" });
    expect(preview).toHaveAttribute("src", "blob:mock-1");
    expect(preview).toHaveClass("size-12", "rounded", "border");
    expect(
      screen.queryByRole("img", { name: "Saved logo" })
    ).not.toBeInTheDocument();
    // The picked file stays in the input, under the caller's field name.
    expect(fileInput().name).toBe("image");
    expect(fileInput().files?.[0]).toBe(file);
  });

  it("keeps the saved image when the picked file is rejected", async () => {
    const user = userEvent.setup();
    renderField();

    await user.upload(fileInput(), pngFile("too-big.png", TOO_BIG));

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fileInput().files).toHaveLength(0);
    expect(screen.getByRole("img", { name: "Saved logo" })).toBeVisible();
  });

  it("drops an earlier preview when a later pick is rejected", async () => {
    const user = userEvent.setup();
    renderField();

    await user.upload(fileInput(), pngFile("good.png"));
    await user.upload(fileInput(), pngFile("too-big.png", TOO_BIG));

    // Nothing will be uploaded, so the picture is the saved image again.
    expect(screen.getByRole("img", { name: "Saved logo" })).toBeVisible();
    expect(
      screen.queryByRole("img", { name: "Picked file" })
    ).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });

  it("releases each object URL when replaced and on unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderField();

    await user.upload(fileInput(), pngFile("first.png"));
    await user.upload(fileInput(), pngFile("second.png"));

    expect(screen.getByRole("img", { name: "Picked file" })).toHaveAttribute(
      "src",
      "blob:mock-2"
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:mock-2");

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-2");
  });

  it("links the format hint to the input for assistive tech", () => {
    renderField();

    const describedBy = fileInput().getAttribute("aria-describedby") ?? "";
    const hints = describedBy
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(hints).toEqual([
      "Accepts PNG, JPG, JPEG, or WebP (max.4 MB)",
      "Accepts PNG, JPG, JPEG, or WebP (max.4 MB)",
    ]);
  });

  it("shows the error and passes the disabled state to the input", () => {
    renderField({ error: "Max file size is 4MB", disabled: true });

    expect(screen.getByText("Max file size is 4MB")).toBeVisible();
    expect(fileInput()).toBeDisabled();
  });
});
