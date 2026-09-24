/**
 * <WorkspaceLogoField> - unit tests
 *
 * Covers what the user sees next to the "Main image" input:
 *  - the stored logo, on the versioned `/api/image/<id>?v=<updatedAt ms>` URL
 *    (an unversioned URL would keep serving a replaced logo from cache),
 *  - the placeholder when the workspace has no logo,
 *  - the owner's profile picture on a PERSONAL workspace,
 *  - a local preview of a picked file before it is uploaded, and the current
 *    logo again when the picked file fails validation,
 *  - object URLs released when replaced and on unmount.
 *
 * @see {@link file://./workspace-logo-field.tsx}
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { WorkspaceLogoField } from "./workspace-logo-field";

// why: ProfilePicture reads the signed-in user from the _layout route loader,
// which does not exist outside a router.
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({
    username: "owner",
    profilePicture: "https://cdn.example.com/owner.png",
  }),
}));

const UPDATED_AT = new Date("2026-09-24T09:30:00.123Z");

/** Renders the field in its own jotai store so validation state never leaks. */
function renderField(props: Parameters<typeof WorkspaceLogoField>[0] = {}) {
  return render(
    <Provider store={createStore()}>
      <WorkspaceLogoField {...props} />
    </Provider>
  );
}

function logo() {
  return screen.getByRole("img", { name: "Workspace logo" });
}

function fileInput() {
  return screen.getByLabelText("Main image") as HTMLInputElement;
}

function pngFile(name: string, size = 1024) {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

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

describe("WorkspaceLogoField", () => {
  it("shows the stored logo on a URL versioned by updatedAt", () => {
    renderField({ imageId: "img_logo", updatedAt: UPDATED_AT });

    expect(logo()).toHaveAttribute(
      "src",
      `/api/image/img_logo?v=${UPDATED_AT.getTime()}`
    );
  });

  it("shows the placeholder when the workspace has no logo", () => {
    renderField({ imageId: null, updatedAt: UPDATED_AT });

    expect(logo()).toHaveAttribute(
      "src",
      "/static/images/asset-placeholder.jpg"
    );
  });

  it("shows the owner's profile picture on a personal workspace", () => {
    renderField({
      imageId: "img_logo",
      updatedAt: UPDATED_AT,
      isPersonal: true,
    });

    expect(screen.getByRole("img", { name: "owner" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/owner.png"
    );
    expect(
      screen.queryByRole("img", { name: "Workspace logo" })
    ).not.toBeInTheDocument();
  });

  it("previews a picked file before it is uploaded", async () => {
    const user = userEvent.setup();
    renderField({ imageId: "img_logo", updatedAt: UPDATED_AT });
    const file = pngFile("new-logo.png");

    await user.upload(fileInput(), file);

    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(logo()).toHaveAttribute("src", "blob:mock-1");
    // The picked file stays in the input, under the field name the action reads.
    expect(fileInput().name).toBe("image");
    expect(fileInput().files?.[0]).toBe(file);
  });

  it("previews a picked file on a personal workspace too", async () => {
    const user = userEvent.setup();
    renderField({ isPersonal: true });

    await user.upload(fileInput(), pngFile("new-logo.png"));

    expect(logo()).toHaveAttribute("src", "blob:mock-1");
  });

  it("keeps the current logo when the picked file is rejected", async () => {
    const user = userEvent.setup();
    renderField({ imageId: "img_logo", updatedAt: UPDATED_AT });

    await user.upload(
      fileInput(),
      pngFile("too-big.png", DEFAULT_MAX_IMAGE_UPLOAD_SIZE + 1)
    );

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fileInput().files).toHaveLength(0);
    expect(logo()).toHaveAttribute(
      "src",
      `/api/image/img_logo?v=${UPDATED_AT.getTime()}`
    );
  });

  it("drops an earlier preview when a later pick is rejected", async () => {
    const user = userEvent.setup();
    renderField({ imageId: "img_logo", updatedAt: UPDATED_AT });

    await user.upload(fileInput(), pngFile("good.png"));
    await user.upload(
      fileInput(),
      pngFile("too-big.png", DEFAULT_MAX_IMAGE_UPLOAD_SIZE + 1)
    );

    // Nothing will be uploaded, so the picture is the current logo again.
    expect(logo()).toHaveAttribute(
      "src",
      `/api/image/img_logo?v=${UPDATED_AT.getTime()}`
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });

  it("releases each object URL when replaced and on unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderField();

    await user.upload(fileInput(), pngFile("first.png"));
    await user.upload(fileInput(), pngFile("second.png"));

    expect(logo()).toHaveAttribute("src", "blob:mock-2");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:mock-2");

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-2");
  });
});
