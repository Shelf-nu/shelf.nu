/**
 * TeamUpgradeBanner — unit tests
 *
 * The banner sits above the non-registered members list on a Personal
 * workspace, so it has to fold out of the way — and, because it is the only
 * place the invite limit is explained, it has to fold back open. These pin
 * both directions, the fact that folding really does put the pitch away, and
 * that the control describes itself to a screen reader.
 *
 * @see {@link file://./team-upgrade-banner.tsx}
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamUpgradeBanner } from "./team-upgrade-banner";

/**
 * Asserts the fold as the browser resolves it, not as `hidden` claims it.
 *
 * `toBeVisible()` reads the `hidden` attribute, and Tailwind is not loaded in
 * this environment — so an element carrying both `hidden` and a `flex` class
 * passes that check while rendering fully open in the app, because `[hidden]`
 * is a user-agent rule and the class is an author rule. The display utility is
 * therefore the only honest thing to assert here.
 */
function expectFolded(folded: boolean) {
  const details = document.getElementById("team-upgrade-banner-details");

  expect(details).not.toBeNull();

  const classes = details?.className.split(/\s+/) ?? [];

  if (folded) {
    expect(details).toHaveAttribute("hidden");
    expect(classes).toContain("hidden");
    expect(classes).not.toContain("flex");
    return;
  }

  expect(details).not.toHaveAttribute("hidden");
  expect(classes).toContain("flex");
  expect(classes).not.toContain("hidden");
}

/** Mutable fetcher state — each test sets this before rendering. */
const mockFetcherState: { formData: FormData | undefined } = {
  formData: undefined,
};

// why: the component uses `useFetcher` to persist the fold, which needs a
// router context. The tests drive the fetcher state directly instead.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    Link: ({ children, ...rest }: { children: ReactNode }) => (
      <a {...rest}>{children}</a>
    ),
    useFetcher: () => ({
      ...mockFetcherState,
      state: "idle" as const,
      Form: ({ children, ...rest }: { children: ReactNode }) => (
        <form {...rest}>{children}</form>
      ),
    }),
  };
});

/** Sets the in-flight submission the component should follow. */
function submitting(collapsed: "true" | "false") {
  const formData = new FormData();
  formData.set("collapsed", collapsed);
  mockFetcherState.formData = formData;
}

function renderBanner(collapsed = false) {
  return render(
    <TeamUpgradeBanner
      ctaTo="/account-details/subscription"
      ctaLabel="Upgrade to Team"
      collapsed={collapsed}
    />
  );
}

describe("TeamUpgradeBanner", () => {
  it("states the limit and offers the resolved action when open", () => {
    mockFetcherState.formData = undefined;
    renderBanner();

    expect(
      screen.getByText("Inviting people needs a Team workspace")
    ).toBeTruthy();
    // The CTA wording is decided upstream from entitlement, not hardcoded here.
    expect(screen.getByText("Upgrade to Team")).toBeTruthy();
    expectFolded(false);
  });

  it("keeps the headline but puts the pitch away when folded", () => {
    mockFetcherState.formData = undefined;
    renderBanner(true);

    // The headline survives, so the explanation stays findable …
    expect(
      screen.getByText("Inviting people needs a Team workspace")
    ).toBeTruthy();
    // … while the detail region is folded away. A fold that still showed the
    // CTA would not be a fold.
    expectFolded(true);
  });

  it("folds on submit, without waiting for the round trip", () => {
    submitting("true");
    renderBanner(false);

    expectFolded(true);
  });

  it("unfolds on submit, so a stored fold is not one-way", () => {
    submitting("false");
    renderBanner(true);

    expectFolded(false);
  });

  it("names the control for what it will do next", () => {
    mockFetcherState.formData = undefined;
    const { rerender } = renderBanner(false);

    expect(
      screen.getByRole("button", {
        name: "Hide why inviting people needs a Team workspace",
        expanded: true,
      })
    ).toBeTruthy();

    rerender(
      <TeamUpgradeBanner
        ctaTo="/account-details/subscription"
        ctaLabel="Upgrade to Team"
        collapsed
      />
    );

    expect(
      screen.getByRole("button", {
        name: "Show why inviting people needs a Team workspace",
        expanded: false,
      })
    ).toBeTruthy();
  });
});
