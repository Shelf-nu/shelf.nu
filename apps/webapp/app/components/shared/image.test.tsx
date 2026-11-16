/**
 * <Image> — unit tests
 *
 * Verifies the URL contract of the shared image renderer:
 *  - `updatedAt` is encoded as a stable `?v=` version so the browser cache is
 *    busted exactly when the stored blob changes (the serving route uses a
 *    year-long `Cache-Control` and stored images are replaced in place, so an
 *    unversioned URL would keep showing the previous image).
 *  - The version is deterministic — same props, same URL — so server and
 *    client renders agree and re-renders don't refetch.
 *  - Missing/invalid `updatedAt` falls back to the bare URL; a missing
 *    `imageId` renders the placeholder.
 *
 * @see {@link file://./image.tsx}
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Image } from "./image";

const UPDATED_AT = new Date("2026-09-01T14:19:22.345Z");

describe("Image", () => {
  it("versions the URL with the updatedAt timestamp", () => {
    render(<Image imageId="img_1" alt="logo" updatedAt={UPDATED_AT} />);

    expect(screen.getByRole("img", { name: "logo" })).toHaveAttribute(
      "src",
      `/api/image/img_1?v=${UPDATED_AT.getTime()}`
    );
  });

  it("accepts a serialized (string) updatedAt, as loader data provides", () => {
    render(
      <Image imageId="img_1" alt="logo" updatedAt={UPDATED_AT.toISOString()} />
    );

    expect(screen.getByRole("img", { name: "logo" })).toHaveAttribute(
      "src",
      `/api/image/img_1?v=${UPDATED_AT.getTime()}`
    );
  });

  it("renders the same URL on every render for the same props", () => {
    const { rerender } = render(
      <Image imageId="img_1" alt="logo" updatedAt={UPDATED_AT} />
    );
    const firstSrc = screen
      .getByRole("img", { name: "logo" })
      .getAttribute("src");

    rerender(<Image imageId="img_1" alt="logo" updatedAt={UPDATED_AT} />);

    expect(screen.getByRole("img", { name: "logo" }).getAttribute("src")).toBe(
      firstSrc
    );
  });

  it("omits the version when updatedAt is absent or invalid", () => {
    render(<Image imageId="img_1" alt="logo" />);

    expect(screen.getByRole("img", { name: "logo" })).toHaveAttribute(
      "src",
      "/api/image/img_1"
    );
  });

  it("renders the placeholder when there is no imageId", () => {
    render(<Image alt="logo" />);

    expect(screen.getByRole("img", { name: "logo" })).toHaveAttribute(
      "src",
      "/static/images/asset-placeholder.jpg"
    );
  });
});
