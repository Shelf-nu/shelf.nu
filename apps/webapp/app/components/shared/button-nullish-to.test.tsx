/**
 * Pins how `<Button>` behaves when its `to` prop is nullish.
 *
 * Both cases fail SILENTLY — no console error, no thrown exception, nothing
 * a reviewer or a passing CI run would notice — which is why a dead Cancel
 * button shipped to production on `/assets/new`. These tests exist so the
 * trap is written down and stays visible: if someone "fixes" `isLinkProps`
 * or the `type="button"` default later, they should see exactly which
 * behaviours were load-bearing.
 *
 * The rule for call sites: NEVER bind a nullable value straight to `to`.
 * Resolve it first (`referer ?? "/assets"`), the way AssetForm, KitsForm and
 * LocationForm all now do.
 *
 * @see {@link file://./button.tsx} — `isLinkProps` is the branch point
 * @see {@link file://./../assets/form.tsx} — `cancelTo`
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

/** Renders with the REAL react-router Link — a mocked Link would hide the
 * `null` -> `href="/"` resolution, which is the whole point of these tests. */
function renderButton(to: unknown) {
  return render(
    <MemoryRouter>
      <Button to={to as string} variant="secondary">
        Cancel
      </Button>
    </MemoryRouter>
  );
}

describe("Button with a nullish `to`", () => {
  it("renders an INERT button when `to` is undefined", () => {
    renderButton(undefined);

    // isLinkProps() requires `to !== undefined`, so this falls through to the
    // `as="button"` branch and picks up the type="button" default.
    expect(screen.queryByRole("link")).toBeNull();

    const button = screen.getByRole("button", { name: "Cancel" });
    // No href and no onClick: clicking it does nothing at all. type="button"
    // means it cannot even submit the surrounding form.
    expect(button).not.toHaveAttribute("href");
    expect(button).toHaveAttribute("type", "button");
  });

  it("links to the site root when `to` is null", () => {
    renderButton(null);

    // `null !== undefined`, so isLinkProps() passes and react-router resolves
    // the nullish target to "/" — a valid link to the WRONG place.
    const link = screen.getByRole("link", { name: "Cancel" });
    expect(link).toHaveAttribute("href", "/");
  });

  it("links to the given path when `to` is a resolved string", () => {
    renderButton("/assets");

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/assets"
    );
  });
});
