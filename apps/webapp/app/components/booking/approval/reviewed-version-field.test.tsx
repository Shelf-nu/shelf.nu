/**
 * The hidden field that binds an approver's check-out to the request version
 * the booking page showed.
 *
 * @see {@link file://./reviewed-version-field.tsx}
 */
import { render } from "@testing-library/react";
import { useRouteLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewedVersionField } from "./reviewed-version-field";

// why: the field reads the booking page's loader data, which needs a data
// router; the test drives that data directly.
vi.mock("react-router", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("react-router")),
  useRouteLoaderData: vi.fn(),
}));

const loaderData = vi.mocked(useRouteLoaderData);

/** Renders the field inside a form and returns the posted value, if any. */
function postedVersion() {
  const { container } = render(
    <form>
      <ReviewedVersionField />
    </form>
  );
  const form = container.querySelector("form") as HTMLFormElement;
  return new FormData(form).get("reviewedVersion");
}

describe("ReviewedVersionField", () => {
  beforeEach(() => {
    loaderData.mockReset();
  });

  it("posts the request version the booking page loaded", () => {
    loaderData.mockReturnValue({ requestVersion: "v-shown" });
    expect(postedVersion()).toBe("v-shown");
    expect(loaderData).toHaveBeenCalledWith(
      "routes/_layout+/bookings.$bookingId.overview"
    );
  });

  it("posts nothing when the page has no version or is not the booking page", () => {
    loaderData.mockReturnValue({ requestVersion: null });
    expect(postedVersion()).toBeNull();

    loaderData.mockReturnValue(undefined);
    expect(postedVersion()).toBeNull();
  });
});
