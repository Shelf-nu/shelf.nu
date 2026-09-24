/**
 * <WorkspaceLogoField> - unit tests
 *
 * Covers which picture the workspace forms show next to the "Main image"
 * input:
 *  - the stored logo, on the versioned `/api/image/<id>?v=<updatedAt ms>` URL
 *    (an unversioned URL would keep serving a replaced logo from cache),
 *  - the placeholder when the workspace has no logo,
 *  - the owner's profile picture on a PERSONAL workspace,
 *  - a picked file's preview, at the logo's size, on both kinds of workspace.
 * Validation and object URL cleanup are covered by the shared field's tests.
 *
 * @see {@link file://./workspace-logo-field.tsx}
 * @see {@link file://../forms/image-file-field.test.tsx}
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** The logo picture shown next to the input (not the personal-workspace avatar). */
function logo() {
  return screen.getByRole("img", { name: "Workspace logo" });
}

/** The "Main image" file input the workspace actions read as `image`. */
function fileInput() {
  return screen.getByLabelText("Main image") as HTMLInputElement;
}

/**
 * Builds a small PNG `File` the shared validator accepts.
 *
 * @param name - File name (keep it clean so the validator does not rename it)
 */
function pngFile(name: string) {
  return new File([new Uint8Array(1024)], name, { type: "image/png" });
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
    expect(logo()).toHaveClass("size-12", "rounded-[4px]", "object-cover");
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
});
