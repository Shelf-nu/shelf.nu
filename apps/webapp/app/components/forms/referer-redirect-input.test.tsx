/**
 * Tests for {@link RefererRedirectInput}: the form posts the referer it
 * mounted with, so a loader re-run that changes the `referer` prop (an asset
 * form navigating to `?category=<id>`) cannot change where Save returns to.
 *
 * @see {@link file://./referer-redirect-input.tsx}
 */
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { RefererRedirectInput } from "./referer-redirect-input";

/** The hidden `redirectTo` input, or `null` when none is rendered. */
function redirectToInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[name="redirectTo"]');
}

describe("RefererRedirectInput", () => {
  beforeAll(() => {
    // A single history entry means "opened in a new tab", which clears the
    // value on purpose; these cases model a page reached by navigation.
    window.history.pushState({}, "", "/assets/asset-1/edit");
  });

  it("keeps the mount-time referer when the prop later becomes null", () => {
    const { container, rerender } = render(
      <RefererRedirectInput fieldName="redirectTo" referer="/assets?search=x" />
    );

    rerender(<RefererRedirectInput fieldName="redirectTo" referer={null} />);

    expect(redirectToInput(container)).toHaveValue("/assets?search=x");
  });

  it("keeps the mount-time referer when the prop later points elsewhere", () => {
    const { container, rerender } = render(
      <RefererRedirectInput fieldName="redirectTo" referer="/assets?search=x" />
    );

    rerender(
      <RefererRedirectInput
        fieldName="redirectTo"
        referer="/assets/asset-1/edit?category=cat-1"
      />
    );

    expect(redirectToInput(container)).toHaveValue("/assets?search=x");
  });

  it("renders nothing when it mounts without a referer", () => {
    const { container } = render(
      <RefererRedirectInput fieldName="redirectTo" referer={null} />
    );

    expect(redirectToInput(container)).toBeNull();
  });
});
